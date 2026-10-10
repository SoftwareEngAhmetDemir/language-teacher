/** Starting points for a group conversation. The brief is what the characters are told about the setting. */
export const SCENES = [
  { id: "cafe", title: "Coffee shop chat", brief: "Friends sit at a table in a coffee shop, chatting casually about their week." },
  { id: "study", title: "Study group", brief: "A study group sits at a table, talking about a project and how they like to study." },
  { id: "dinner", title: "Dinner table", brief: "Friends share a dinner and talk about food and their favourite meals." },
  { id: "travel", title: "Planning a trip", brief: "The group plans a holiday together: places to visit, food to try and things to do." },
  { id: "weekend", title: "Weekend plans", brief: "Friends talk about what they did last weekend and what they plan to do next." },
] as const;

export const DEFAULT_SCENE = SCENES[0].id;

export function sceneBrief(id: unknown): string | undefined {
  return SCENES.find((s) => s.id === id)?.brief;
}
