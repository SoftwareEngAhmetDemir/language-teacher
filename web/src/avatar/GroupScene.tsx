import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Character } from "./characters";
import { createCartoonRig } from "./cartoonRig";
import { MouthDriver } from "./lipSync";
import type { Rig } from "./rig";
import { buildRoom, buildTable, paletteFor } from "./room";
import { createKit } from "./sceneKit";
import { PERSON_SCALE, seatLayout } from "./seating";
import { loadVrmRig } from "./vrmRig";

export interface Seat {
  id: string;
  /** Shown on the name label. */
  name: string;
  /** The person's colour on the name label. */
  color: string;
  character: Character;
}

interface Props {
  seats: Seat[];
  /** Picks the room's colours and decoration. */
  sceneId?: string;
  /** The analyser carrying this character's voice right now, if its audio is playing through the page. */
  analyserFor: (id: string) => AnalyserNode | null;
  /** Who is talking (their lips move) and who is about to talk (their label shows "…"). */
  speakingId: string | null;
  thinkingId: string | null;
  /** Who the current speaker is talking to: a character id, "user" for the student, or null for the whole table. */
  addresseeId: string | null;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

const CENTRE_Z = 0.2;
/** Table top and floor are measured from the middle of a seated head. */
const TABLE_TOP = -1.45;
const FLOOR = TABLE_TOP - 2.5;
/** Where the name labels hang above the middle of a head. */
const LABEL_HEIGHT = 1.05;
const FOV = 30;
/** How far the back wall is behind the middle of the table, and how far to each side its furniture reaches. */
const BACK_WALL_DISTANCE = 10;
const ROOM_HALF_WIDTH = 9.6;

type LabelState = "idle" | "speaking" | "thinking";

/** "Professor Whiskers" becomes "Professor" on the label; short names stay as they are. */
const shortName = (name: string) => (name.length > 10 ? name.split(" ")[0] : name);

interface Placed {
  seat: Seat;
  group: THREE.Group;
  baseY: number;
  /** How far the middle of the head sits above the seat's origin (taller, realistically proportioned characters). */
  lift: number;
  rig: Rig | null;
  driver: MouthDriver;
  /** What this person is looking at, and when to choose again. */
  lookTarget: THREE.Vector3;
  nextLook: number;
  /** Look at the conversation partner first after the speaker or the person spoken to changes. */
  lookAtPartnerFirst: boolean;
  lean: number;
  labelState: LabelState;
}

/** Up to five teachers around a table in a furnished room. Each moves its mouth with its own voice and looks at whoever is talking. */
export default function GroupScene({ seats, sceneId, analyserFor, speakingId, thinkingId, addresseeId }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<(HTMLDivElement | null)[]>([]);
  const latest = useRef({ analyserFor, speakingId, thinkingId, addresseeId });
  const [failed, setFailed] = useState(false);
  const seatKey = seats.map((s) => s.id).join(",");

  useEffect(() => {
    latest.current = { analyserFor, speakingId, thinkingId, addresseeId };
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const palette = paletteFor(sceneId);
    const layout = seatLayout(seats.length);
    // People sit just outside the table's edge, leaning in to rest their arms on it, not inside it.
    const tableRadius = layout.radius - 0.45;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(palette.wallBottom);
    scene.fog = new THREE.Fog(palette.wallBottom, 16, 46);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 80);

    // Light: soft sky and ground light, a key light that casts shadows, and a warm glow from the lamp.
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb59a7a, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(4, 8, 7);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    Object.assign(key.shadow.camera, { left: -10, right: 10, top: 8, bottom: -8, near: 1, far: 34 });
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.04;
    scene.add(key);
    const glow = new THREE.PointLight(0xffd9a0, 20, 10, 1.6);
    glow.position.set(0, 2.1, CENTRE_Z);
    scene.add(glow);

    const kit = createKit();
    buildRoom(kit, scene, { palette, floor: FLOOR, tableTop: TABLE_TOP, tableRadius, rugRadius: layout.radius + 1.4, centreZ: CENTRE_Z });
    buildTable(kit, scene, { palette, floor: FLOOR, tableTop: TABLE_TOP, radius: tableRadius, centreZ: CENTRE_Z });

    const placed: Placed[] = seats.map((seat, i) => {
      const angle = layout.angles[i];
      const outward = new THREE.Vector3(Math.sin(angle), 0, -Math.cos(angle)); // from the table's centre out to the seat
      const sideways = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
      const group = new THREE.Group();
      const baseY = 0.1;
      group.position.set(outward.x * layout.radius, baseY, CENTRE_Z + outward.z * layout.radius);
      group.rotation.y = -angle;
      scene.add(group);

      // A chair: a seat under the person and a tall rounded back behind them.
      const seatCushion = kit.solid(new RoundedBoxGeometry(1.7, 0.28, 1.4, 3, 0.1), palette.chair, { edge: 1.03 });
      seatCushion.position.set(outward.x * (layout.radius + 0.2), baseY - 1.72, CENTRE_Z + outward.z * (layout.radius + 0.2));
      seatCushion.rotation.y = -angle;
      scene.add(seatCushion);
      const back = kit.solid(new RoundedBoxGeometry(1.6, 2.0, 0.26, 4, 0.12), palette.chair, { edge: 1.03 });
      back.position.set(outward.x * (layout.radius + 0.75), baseY - 0.5, CENTRE_Z + outward.z * (layout.radius + 0.75));
      back.rotation.y = -angle;
      scene.add(back);

      // A place setting in front of each person: a plate, with a mug to one side.
      const place = new THREE.Vector3(outward.x * (layout.radius - 1.05), TABLE_TOP, CENTRE_Z + outward.z * (layout.radius - 1.05));
      const plate = kit.solid(new THREE.CylinderGeometry(0.34, 0.3, 0.04, 28), 0xffffff, { edge: 1.05 });
      plate.position.set(place.x, TABLE_TOP + 0.02, place.z);
      const mug = kit.solid(new THREE.CylinderGeometry(0.14, 0.12, 0.2, 18), [0x4aa3df, 0xe57373, 0x81c784, 0xba68c8, 0xffb74d][i % 5], { edge: 1.08 });
      mug.position.set(place.x + sideways.x * 0.62, TABLE_TOP + 0.1, place.z + sideways.z * 0.62);
      scene.add(plate, mug);

      return { seat, group, baseY, lift: 0, rig: null, driver: new MouthDriver(), lookTarget: camera.position.clone(), nextLook: 0, lookAtPartnerFirst: false, lean: 0, labelState: "idle" };
    });

    let disposed = false;
    placed.forEach((p) => {
      const character = p.seat.character;
      const load = character.kind === "vrm" ? loadVrmRig(character.url, { seated: true }) : Promise.resolve(createCartoonRig(character.look, { armsOnTable: true }));
      load
        .then((rig) => {
          if (disposed) return rig.dispose();
          if (rig.seatedFit) {
            rig.object.scale.setScalar(rig.seatedFit.scale);
            rig.object.position.y = rig.seatedFit.lift;
            p.lift = rig.seatedFit.lift;
          } else {
            rig.object.scale.setScalar(PERSON_SCALE * rig.scaleHint);
          }
          // Characters cast shadows onto the table and chair; the dark outline shells don't, to avoid speckles.
          rig.object.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (mesh.isMesh && !(mesh.material instanceof THREE.MeshBasicMaterial)) mesh.castShadow = true;
          });
          p.group.add(rig.object);
          p.rig = rig;
        })
        .catch((err) => console.error("Could not load a character", p.seat.id, err));
    });

    // Fit everyone in view whatever the shape of the canvas: the camera backs away as the table gets wider.
    const needHalfWidth = Math.sin(Math.max(...layout.angles.map(Math.abs))) * layout.radius + 1.5;
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // Back far enough to see the whole room, not only the table: its side walls' furniture (bookcase, window,
      // plant) reach ROOM_HALF_WIDTH to each side of the middle of the back wall. Everyone at the table must fit too.
      const reach = Math.tan((FOV / 2) * (Math.PI / 180)) * camera.aspect;
      const forTable = needHalfWidth / reach;
      const forRoom = ROOM_HALF_WIDTH / reach - BACK_WALL_DISTANCE;
      const distance = clamp(Math.max(forTable, forRoom), 10.5, 26);
      camera.position.set(0, 3.2 + distance * 0.06, distance);
      camera.lookAt(0, TABLE_TOP + 1.7, 0);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const heads = placed.map(() => new THREE.Vector3());
    const projected = new THREE.Vector3();
    let last = performance.now();
    let t = 0;
    let frame = 0;
    let conversationKey = "";
    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt;
      const { analyserFor: analyser, speakingId: speaking, thinkingId: thinking, addresseeId: addressee } = latest.current;
      const { clientWidth: width, clientHeight: height } = canvas;

      placed.forEach((p, i) => {
        p.group.getWorldPosition(heads[i]);
        heads[i].y += p.lift;
      });
      const talker = placed.findIndex((q) => q.seat.id === speaking);
      // The person being spoken to, if it is one of the characters; or the student, who is where the camera is.
      const partner = addressee && addressee !== "user" ? placed.findIndex((q) => q.seat.id === addressee) : -1;
      const toStudent = addressee === "user";
      // When the speaker or the person spoken to changes, everyone turns straight away.
      const key = `${speaking}|${addressee}`;
      if (key !== conversationKey) {
        conversationKey = key;
        placed.forEach((p) => {
          p.nextLook = 0;
          p.lookAtPartnerFirst = true;
        });
      }
      placed.forEach((p, i) => {
        const isSpeaking = p.seat.id === speaking;

        // The speaker leans in a little.
        p.lean += ((isSpeaking ? 1 : 0) - p.lean) * (1 - Math.exp(-dt / 0.2));
        p.group.scale.setScalar(1 + p.lean * 0.04);
        p.group.position.y = p.baseY + p.lean * 0.03;

        // The name label follows the head on the screen; it is plain HTML so the text stays sharp.
        const label = labelRefs.current[i];
        if (label) {
          projected.set(p.group.position.x, p.baseY + p.lift + LABEL_HEIGHT + p.lean * 0.05, p.group.position.z).project(camera);
          label.style.transform = `translate(${(projected.x * 0.5 + 0.5) * width}px, ${(-projected.y * 0.5 + 0.5) * height}px) translate(-50%, -100%)`;
          const state: LabelState = isSpeaking ? "speaking" : p.seat.id === thinking ? "thinking" : "idle";
          if (state !== p.labelState) {
            p.labelState = state;
            label.dataset.state = state;
          }
        }

        if (!p.rig) return;
        // Where to look. The speaker looks at the person they are talking to, and that person looks back; everyone
        // else follows the speaker and now and then glances at the person being spoken to. With nobody speaking, or
        // a remark to the whole table, eyes wander around the table and to the student.
        if (t > p.nextLook) {
          const others = placed.map((_, j) => j).filter((j) => j !== i);
          const around = () => (others.length && Math.random() < 0.7 ? heads[others[Math.floor(Math.random() * others.length)]] : camera.position);
          const first = p.lookAtPartnerFirst;
          p.lookAtPartnerFirst = false;
          p.nextLook = t + rand(1.6, 3.6);
          let target: THREE.Vector3;
          if (isSpeaking) {
            if (partner >= 0) target = first || Math.random() < 0.85 ? heads[partner] : around();
            else if (toStudent) target = first || Math.random() < 0.8 ? camera.position : around();
            else target = Math.random() < 0.45 ? camera.position : around();
          } else if (i === partner && talker >= 0) {
            target = first || Math.random() < 0.92 ? heads[talker] : camera.position;
          } else if (talker >= 0) {
            const roll = Math.random();
            target = roll < 0.72 || first ? heads[talker] : roll < 0.9 && partner >= 0 ? heads[partner] : around();
          } else {
            target = around();
          }
          p.lookTarget = target.clone();
        }

        const { visemes, level } = p.driver.update(dt, analyser(p.seat.id), isSpeaking);
        p.rig.update(dt, { visemes, level, speaking: isSpeaking, attentive: !isSpeaking && talker >= 0 }, p.lookTarget);
      });
      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      placed.forEach((p) => p.rig?.dispose());
      kit.dispose();
      renderer.dispose();
    };
    // Rebuilt when who is at the table, or the scene, changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seatKey, sceneId]);

  return (
    <div className="avatar group-scene">
      <canvas ref={canvasRef} />
      <div className="seat-labels" aria-hidden="true">
        {seats.map((seat, i) => (
          <div key={seat.id} ref={(el) => { labelRefs.current[i] = el; }} className="seat-label" data-state="idle" style={{ "--seat": seat.color } as React.CSSProperties}>
            <span className="dot" />
            <span className="name">{shortName(seat.name)}</span>
            <span className="state"><i /><i /><i /></span>
          </div>
        ))}
      </div>
      {failed && <span className="avatar-note">The 3D table couldn't load on this device.</span>}
    </div>
  );
}
