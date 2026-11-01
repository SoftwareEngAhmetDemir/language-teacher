import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { Palette } from "./room";
import type { Kit } from "./sceneKit";
import type { PropId } from "./sceneStyle";

/** Which props go where. A room has at most one on the wall, two on the floor and one in the middle of the table. */
export const WALL_PROPS: readonly PropId[] = ["map", "tv"];
export const FLOOR_PROPS: readonly PropId[] = ["guitar", "ball", "globe", "suitcase", "easel"];
export const CENTREPIECES: readonly PropId[] = ["flowers", "food", "laptop"];

export interface PropContext {
  kit: Kit;
  /** Where the prop is added: the scene, or the part of it that is hidden when a painted backdrop replaces the wall. */
  scene: THREE.Object3D;
  palette: Palette;
  /** Height of the floor, and the wall's depth. */
  floor: number;
  wallZ: number;
}

function drawn(width: number, height: number, draw: (ctx: CanvasRenderingContext2D) => void): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/** The same "random" numbers every time, so a prop does not change when the room is rebuilt. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** A world map in a frame, or a television, hung where the two pictures usually are. */
export function buildWallProp(id: "map" | "tv", x: number, { kit, scene, palette, floor, wallZ }: PropContext): void {
  const { solid, flat, own } = kit;
  const y = floor + 5.6;
  const w = id === "map" ? 3.4 : 3.1;
  const h = id === "map" ? 2.1 : 1.8;
  const frame = solid(new THREE.BoxGeometry(w + 0.24, h + 0.24, id === "map" ? 0.12 : 0.16), id === "map" ? 0x3a2a20 : 0x1b1b1b, { edge: 1.01, castShadow: false });
  frame.position.set(x, y, wallZ + 0.1);
  scene.add(frame);

  const random = seeded(id === "map" ? 11 : 5);
  const texture = drawn(320, 200, (ctx) => {
    if (id === "map") {
      ctx.fillStyle = "#8ec9ea";
      ctx.fillRect(0, 0, 320, 200);
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 1;
      for (let gx = 0; gx <= 320; gx += 40) ctx.strokeRect(gx, 0, 0.1, 200);
      for (let gy = 0; gy <= 200; gy += 40) ctx.strokeRect(0, gy, 320, 0.1);
      // Continents: a few lumpy blobs.
      for (const [cx, cy, r, c] of [[80, 70, 46, "#7fbf6a"], [105, 150, 30, "#6aae5a"], [180, 60, 36, "#e0c27a"], [200, 120, 38, "#7fbf6a"], [260, 80, 40, "#6aae5a"], [275, 160, 20, "#e0c27a"]] as const) {
        ctx.fillStyle = c;
        ctx.beginPath();
        for (let a = 0; a <= 12; a++) {
          const angle = (a / 12) * Math.PI * 2;
          const radius = r * (0.7 + random() * 0.5);
          ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.8);
        }
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = hex(palette.lamp);
      for (const [px, py] of [[85, 65], [190, 115], [255, 85]]) {
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      const glow = ctx.createLinearGradient(0, 0, 320, 200);
      glow.addColorStop(0, hex(palette.curtain));
      glow.addColorStop(1, hex(palette.lamp));
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 320, 200);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.beginPath();
      ctx.moveTo(138, 70);
      ctx.lineTo(138, 130);
      ctx.lineTo(190, 100);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(20, 172, 280, 6);
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillRect(20, 172, 110, 6);
    }
  });
  const face = flat(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: own(texture) }));
  face.position.set(x, y, wallZ + (id === "map" ? 0.18 : 0.21));
  scene.add(face);
}

/** A guitar, a ball, a globe, a stack of suitcases or an easel standing on the floor at (x, z). */
export function buildFloorProp(id: "guitar" | "ball" | "globe" | "suitcase" | "easel", x: number, z: number, { kit, scene, palette, floor, wallZ }: PropContext): void {
  const { solid, flat, own } = kit;
  const group = new THREE.Group();
  group.position.set(x, floor, z);

  if (id === "guitar") {
    // Leaning against the wall: a body of two round parts, a sound hole, a neck and a headstock.
    const bodyColor = 0xc9742f;
    const lower = solid(new THREE.CylinderGeometry(0.44, 0.44, 0.18, 28), bodyColor);
    lower.rotation.x = Math.PI / 2;
    lower.position.set(0, 0.6, 0);
    const upper = solid(new THREE.CylinderGeometry(0.32, 0.32, 0.18, 28), bodyColor);
    upper.rotation.x = Math.PI / 2;
    upper.position.set(0, 1.2, 0);
    const hole = flat(new THREE.CircleGeometry(0.13, 20), new THREE.MeshBasicMaterial({ color: 0x1b1b1b }));
    hole.position.set(0, 0.85, 0.095);
    const neck = solid(new THREE.BoxGeometry(0.15, 1.5, 0.1), 0x4a3020, { edge: 1.04 });
    neck.position.set(0, 2.0, 0);
    const head = solid(new THREE.BoxGeometry(0.22, 0.4, 0.1), 0x2b1d14, { edge: 1.04 });
    head.position.set(0, 2.95, 0);
    group.add(lower, upper, hole, neck, head);
    group.rotation.z = -0.1;
    group.position.z = wallZ + 0.35;
  } else if (id === "ball") {
    const radius = 0.55;
    const ball = solid(new THREE.SphereGeometry(radius, 28, 20), 0xe9702b, { edge: 1.03 });
    ball.position.y = radius;
    for (const [rx, ry] of [[0, 0], [0, Math.PI / 2], [Math.PI / 2, 0]]) {
      const seam = flat(new THREE.TorusGeometry(radius * 1.005, 0.018, 6, 40), new THREE.MeshBasicMaterial({ color: 0x1b1b1b }));
      seam.rotation.set(rx, ry, 0);
      ball.add(seam);
    }
    group.add(ball);
  } else if (id === "globe") {
    const base = solid(new THREE.CylinderGeometry(0.42, 0.48, 0.12, 24), 0x4a3020);
    base.position.y = 0.06;
    const pole = solid(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 10), 0x4a3020, { edge: 1.1 });
    pole.position.y = 0.7;
    const random = seeded(23);
    const earth = drawn(256, 128, (ctx) => {
      ctx.fillStyle = "#3d8fd1";
      ctx.fillRect(0, 0, 256, 128);
      ctx.fillStyle = "#79b85f";
      for (let i = 0; i < 9; i++) {
        ctx.beginPath();
        ctx.ellipse(random() * 256, 20 + random() * 88, 12 + random() * 26, 8 + random() * 16, random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const sphere = solid(new THREE.SphereGeometry(0.62, 28, 20), 0xffffff, { edge: 1.03, map: own(earth) });
    sphere.position.y = 1.55;
    sphere.rotation.z = 0.4;
    const ring = solid(new THREE.TorusGeometry(0.68, 0.025, 8, 40), 0xc9a24a, { edge: 0 });
    ring.position.y = 1.55;
    ring.rotation.y = Math.PI / 2;
    group.add(base, pole, sphere, ring);
  } else if (id === "suitcase") {
    const big = solid(new RoundedBoxGeometry(1.15, 0.8, 0.45, 3, 0.07), palette.chair, { edge: 1.03 });
    big.position.y = 0.4;
    const small = solid(new RoundedBoxGeometry(0.8, 0.55, 0.38, 3, 0.07), palette.lamp, { edge: 1.03 });
    small.position.set(0.05, 1.08, 0);
    small.rotation.y = 0.15;
    for (const [handleY, handleX, size] of [[0.86, 0, 0.18], [1.4, 0.05, 0.14]] as const) {
      const handle = solid(new THREE.TorusGeometry(size, 0.025, 8, 16, Math.PI), 0x2b2b2b, { edge: 0, castShadow: false });
      handle.position.set(handleX, handleY, 0);
      group.add(handle);
    }
    for (const sx of [-0.35, 0.35]) {
      const strap = solid(new THREE.BoxGeometry(0.06, 0.82, 0.47), 0xe8e0d0, { edge: 0, castShadow: false });
      strap.position.set(sx, 0.4, 0);
      group.add(strap);
    }
    group.add(big, small);
    group.rotation.y = 0.25;
  } else {
    // An easel holding a painting.
    const wood = 0x8a6240;
    for (const [dx, tilt] of [[-0.55, 0.16], [0.55, -0.16]] as const) {
      const leg = solid(new THREE.BoxGeometry(0.08, 2.9, 0.08), wood, { edge: 1.05 });
      leg.position.set(dx * 0.85, 1.45, 0);
      leg.rotation.z = tilt;
      group.add(leg);
    }
    const back = solid(new THREE.BoxGeometry(0.08, 2.7, 0.08), wood, { edge: 1.05 });
    back.position.set(0, 1.35, -0.6);
    back.rotation.x = -0.22;
    const rest = solid(new THREE.BoxGeometry(1.5, 0.07, 0.12), wood, { edge: 1.05 });
    rest.position.set(0, 0.95, 0.1);
    const canvasBoard = solid(new THREE.BoxGeometry(1.25, 1.6, 0.06), 0xffffff, { edge: 1.03 });
    canvasBoard.position.set(0, 1.85, 0.1);
    const random = seeded(31);
    const painting = drawn(160, 200, (ctx) => {
      ctx.fillStyle = "#f6efe4";
      ctx.fillRect(0, 0, 160, 200);
      for (const c of [palette.rim, palette.lamp, palette.curtain, palette.decor, palette.chair]) {
        ctx.fillStyle = hex(c);
        ctx.globalAlpha = 0.85;
        ctx.beginPath();
        ctx.arc(20 + random() * 120, 25 + random() * 150, 22 + random() * 26, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    });
    const art = flat(new THREE.PlaneGeometry(1.1, 1.45), new THREE.MeshBasicMaterial({ map: own(painting) }));
    art.position.set(0, 1.85, 0.135);
    group.add(back, rest, canvasBoard, art);
    group.rotation.y = 0.2;
  }
  scene.add(group);
}

/** What sits in the middle of the table: flowers, a pizza with cups, or a laptop with a notebook. */
export function buildCentrepiece(id: "flowers" | "food" | "laptop", tableTop: number, centreZ: number, { kit, scene, palette }: PropContext): void {
  const { solid, flat } = kit;
  const group = new THREE.Group();
  group.position.set(0, tableTop, centreZ);

  if (id === "flowers") {
    const vase = solid(new THREE.CylinderGeometry(0.2, 0.15, 0.34, 20), 0x4aa3df, { edge: 1.06 });
    vase.position.y = 0.17;
    group.add(vase);
    const stems: [number, number, number][] = [[0, 0.62, 0], [-0.17, 0.52, 0.04], [0.18, 0.55, -0.03], [0.04, 0.5, 0.17], [-0.06, 0.54, -0.16]];
    stems.forEach(([x, y, z], i) => {
      const bloom = solid(new THREE.SphereGeometry(0.13, 16, 12), [0xf2c230, 0xe57373, 0xffffff, 0xf8a5c2, 0xf2c230][i], { edge: 1.08 });
      bloom.position.set(x, y + 0.2, z);
      const leaf = solid(new THREE.SphereGeometry(0.07, 10, 8), 0x4f9a3d, { edge: 0 });
      leaf.position.set(x * 0.5, 0.4, z * 0.5);
      group.add(bloom, leaf);
    });
  } else if (id === "food") {
    const board = solid(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 36), 0x8a6240, { edge: 1.04 });
    board.position.y = 0.025;
    const pizza = solid(new THREE.CylinderGeometry(0.52, 0.52, 0.06, 36), 0xeab552, { edge: 1.04 });
    pizza.position.y = 0.08;
    group.add(board, pizza);
    for (const [x, z] of [[0.2, 0.1], [-0.18, 0.2], [0.05, -0.25], [-0.25, -0.1], [0.28, -0.22]]) {
      const topping = solid(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14), 0xc0392b, { edge: 0, castShadow: false });
      topping.position.set(x, 0.125, z);
      group.add(topping);
    }
    for (const [x, c] of [[-0.85, palette.lamp], [0.85, palette.curtain]] as const) {
      const cup = solid(new THREE.CylinderGeometry(0.11, 0.09, 0.2, 16), c, { edge: 1.08 });
      cup.position.set(x, 0.1, 0.1);
      group.add(cup);
    }
  } else {
    const base = solid(new RoundedBoxGeometry(0.95, 0.05, 0.65, 2, 0.02), 0x9aa3ad, { edge: 1.03 });
    base.position.y = 0.025;
    const lid = new THREE.Group();
    lid.position.set(0, 0.05, -0.3);
    lid.rotation.x = -0.3;
    const shell = solid(new RoundedBoxGeometry(0.95, 0.62, 0.04, 2, 0.02), 0x7d8791, { edge: 1.03 });
    shell.position.set(0, 0.31, 0);
    const screen = flat(new THREE.PlaneGeometry(0.85, 0.52), new THREE.MeshBasicMaterial({ color: 0xbfe3ff }));
    screen.position.set(0, 0.31, 0.025);
    lid.add(shell, screen);
    const notebook = solid(new THREE.BoxGeometry(0.5, 0.04, 0.38), 0xf6efe4, { edge: 1.04 });
    notebook.position.set(-0.85, 0.02, 0.15);
    notebook.rotation.y = 0.3;
    const pencil = solid(new THREE.CylinderGeometry(0.015, 0.015, 0.36, 8), palette.lamp, { edge: 0 });
    pencil.rotation.z = Math.PI / 2;
    pencil.rotation.y = -0.5;
    pencil.position.set(-0.85, 0.065, 0.1);
    group.add(base, lid, notebook, pencil);
  }
  scene.add(group);
}
