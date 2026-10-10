import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { CHARACTER_PROFILES } from "../characters.js";
import { detectAddressee, guard } from "./conductor.js";
import type { GroupLLM } from "./llm.js";
import type { Decision, GroupEvent, Line, RoundRequest } from "./types.js";

/** What a running round needs besides its state. Passed per run, so the compiled graph is shared. */
export interface RoundDeps {
  llm: GroupLLM;
  emit: (event: GroupEvent) => void;
  signal?: AbortSignal;
  /** Pick the round's first speaker by rules instead of asking the model, which saves a whole model call before anyone speaks. */
  fastStart?: boolean;
}

const State = Annotation.Root({
  /** The request: participants, scene, level and the conversation so far (updated as lines are added). */
  req: Annotation<RoundRequest>(),
  turns: Annotation<number>({ reducer: (_, next) => next, default: () => 0 }),
  decision: Annotation<Decision | null>({ reducer: (_, next) => next, default: () => null }),
});

type GraphState = typeof State.State;
const depsOf = (config: { configurable?: Record<string, unknown> }) => config.configurable as unknown as RoundDeps;

/**
 * The conversation as a graph:
 *
 *   START -> conductor --(someone speaks)--> speaker -> conductor -> ...
 *                      \--(hand to student)--> END
 *
 * The conductor picks who speaks next (the model proposes, the rules in conductor.ts decide), the speaker
 * writes that character's line, and the loop repeats until the conductor hands the floor to the student
 * or the round's turn budget is used up.
 */
const graph = new StateGraph(State)
  .addNode("conductor", async (state: GraphState, config) => {
    const { llm, signal, fastStart } = depsOf(config);
    // The first line of a round is the one the student is waiting for: choosing its speaker by rules is
    // nearly as good (the person named, else the teacher) and costs no model call. Later lines use the model
    // while the earlier ones are still being spoken, so its delay is hidden.
    // Once the turn budget is used the round ends whatever the model says, so it is not asked.
    const skipModel = state.turns >= state.req.maxTurns || (fastStart && state.turns === 0);
    const suggestion = skipModel ? null : await llm.decide(state.req, signal);
    const decision = guard(suggestion, {
      participants: state.req.participants,
      transcript: state.req.transcript,
      turns: state.turns,
      maxTurns: state.req.maxTurns,
    });
    return { decision };
  })
  .addNode("speaker", async (state: GraphState, config) => {
    const { llm, emit, signal } = depsOf(config);
    const { next, direction, to } = state.decision!;
    emit({ type: "start", speaker: next });
    // Tell the speaker who the line is for, so they speak to that person by name.
    const forWhom = to === "user" ? `Speak to the student${state.req.studentName ? `, ${state.req.studentName}` : ""}.` : to ? `Speak to ${CHARACTER_PROFILES[to]?.name ?? to}.` : "";
    const note = [direction, forWhom].filter(Boolean).join(" ");
    const text = await llm.speak(state.req, next, note, (delta) => emit({ type: "delta", speaker: next, text: delta }), signal);
    if (!text) throw new Error(`${CHARACTER_PROFILES[next]?.name ?? next} had nothing to say`);
    const addressee = detectAddressee({
      text,
      speaker: next,
      participants: state.req.participants,
      transcript: state.req.transcript,
      studentName: state.req.studentName,
      suggested: to,
    });
    emit({ type: "end", speaker: next, text, addressee });
    const line: Line = { speaker: next, text };
    return { req: { ...state.req, transcript: [...state.req.transcript, line] }, turns: state.turns + 1 };
  })
  .addEdge(START, "conductor")
  .addConditionalEdges("conductor", (state: GraphState) => (state.decision?.next === "user" ? END : "speaker"))
  .addEdge("speaker", "conductor")
  .compile();

/**
 * Runs one round and streams its events. Returns whether the floor now belongs to the student
 * (the conductor handed over, or the budget ran out right after a question) or the characters
 * could keep talking among themselves.
 */
export async function runRound(req: RoundRequest, deps: RoundDeps): Promise<{ awaitUser: boolean }> {
  const final = await graph.invoke({ req }, { configurable: { ...deps }, signal: deps.signal, recursionLimit: 4 * req.maxTurns + 4 });
  const last = final.req.transcript[final.req.transcript.length - 1];
  const spokeThisRound = final.turns > 0;
  const askedStudent = spokeThisRound && last?.text.trim().endsWith("?");
  const awaitUser = final.decision?.yielded === "conductor" || (final.decision?.yielded === "budget" && Boolean(askedStudent));
  return { awaitUser };
}
