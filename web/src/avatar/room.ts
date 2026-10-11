import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { buildCentrepiece, buildFloorProp, buildWallProp, CENTREPIECES, FLOOR_PROPS, WALL_PROPS, type PropContext } from "./props";
import type { Kit } from "./sceneKit";
import type { PropId, Sky } from "./sceneStyle";

/** Colours of a room. Each conversation scene has its own. */
export interface Palette {
  wallTop: string;
  wallBottom: string;
  panel: string;
  floor: string;
  rug: string;
  table: number;
  rim: number;
  chair: number;
  lamp: number;
  curtain: number;
  decor: number;
}

export const PALETTES: Record<string, Palette> = {
  cafe: { wallTop: "#f3e3cf", wallBottom: "#e2c7a6", panel: "#8a5a3c", floor: "#a9754a", rug: "#b6523f", table: 0xc08850, rim: 0x8d5f38, chair: 0x4b3a33, lamp: 0xd8452f, curtain: 0xc86a4a, decor: 0x6aa84f },
  study: { wallTop: "#dfe8f3", wallBottom: "#c4d3e6", panel: "#506a8a", floor: "#8f7a62", rug: "#3f5f8f", table: 0xd9b27a, rim: 0x9a7448, chair: 0x2f4058, lamp: 0x2f6fd8, curtain: 0x5b7fb5, decor: 0x4aa3df },
  dinner: { wallTop: "#f1d9c4", wallBottom: "#dba982", panel: "#7a3b2e", floor: "#7d5638", rug: "#8f3b34", table: 0xa86a3f, rim: 0x6f4226, chair: 0x5a2d28, lamp: 0xf2a33a, curtain: 0xb85a45, decor: 0xc0503a },
  travel: { wallTop: "#d8eefb", wallBottom: "#b6dcf2", panel: "#2f7a8f", floor: "#c4a77d", rug: "#e0a458", table: 0xe0bd86, rim: 0xa2794a, chair: 0x2a6d78, lamp: 0xf2c230, curtain: 0xe8956a, decor: 0xe57373 },
  weekend: { wallTop: "#e3f3dc", wallBottom: "#c5e3b5", panel: "#4f7f4a", floor: "#b58a5a", rug: "#6fa86a", table: 0xcf9c63, rim: 0x94683d, chair: 0x40623b, lamp: 0x81c784, curtain: 0xe0c060, decor: 0xf2c230 },
};
export const paletteFor = (id?: string): Palette => PALETTES[id ?? ""] ?? PALETTES.cafe;

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return [c, c.getContext("2d")!];
}

function texture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A wall: a soft vertical gradient, and below a chair rail a panelled lower part with recessed panels. */
function wallTexture(p: Palette): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, p.wallTop);
  gradient.addColorStop(1, p.wallBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  ctx.fillStyle = p.panel;
  ctx.fillRect(0, 170, 256, 86);
  // Recessed panel with a highlight on the top edge and a shadow on the bottom edge.
  ctx.fillStyle = "rgba(0,0,0,0.16)";
  ctx.fillRect(28, 188, 200, 56);
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(28, 186, 200, 3);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.fillRect(28, 244, 200, 3);
  // Chair rail.
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.fillRect(0, 164, 256, 8);
  ctx.fillStyle = "rgba(0,0,0,0.18)";
  ctx.fillRect(0, 172, 256, 3);
  const t = texture(c);
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(15, 1);
  return t;
}

function floorTexture(color: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = `rgba(${i % 2 ? "255,255,255" : "0,0,0"},${0.05 + (i % 3) * 0.025})`;
    ctx.fillRect(0, i * 32, 256, 32);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(0, i * 32, 256, 2);
    // Plank ends, staggered row to row.
    ctx.fillRect(((i * 97) % 256) | 0, i * 32, 2, 32);
  }
  const t = texture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 5);
  return t;
}

function woodTexture(): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 60; i++) {
    const y = (i * 37) % 256;
    ctx.strokeStyle = `rgba(90,50,20,${0.05 + (i % 5) * 0.015})`;
    ctx.lineWidth = 1 + (i % 3);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(80, y + 6 * Math.sin(i), 160, y - 6 * Math.cos(i), 256, y + 3);
    ctx.stroke();
  }
  return texture(c);
}

function rugTexture(color: string): THREE.CanvasTexture {
  const [c, ctx] = canvas(256, 256);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 256, 256);
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  for (const [r, w] of [[118, 6], [100, 2], [60, 3]] as const) {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(128, 128, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  return texture(c);
}

/** Two small pictures for the wall: a landscape and an abstract. */
function artTexture(kind: "landscape" | "abstract", p: Palette): THREE.CanvasTexture {
  const [c, ctx] = canvas(160, 120);
  const accent = `#${p.decor.toString(16).padStart(6, "0")}`;
  const warm = `#${p.lamp.toString(16).padStart(6, "0")}`;
  if (kind === "landscape") {
    const sky = ctx.createLinearGradient(0, 0, 0, 120);
    sky.addColorStop(0, "#9fd4f5");
    sky.addColorStop(1, "#fbe7c6");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 160, 120);
    ctx.fillStyle = warm;
    ctx.beginPath();
    ctx.arc(112, 40, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, 120);
    ctx.quadraticCurveTo(50, 50, 110, 120);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.beginPath();
    ctx.moveTo(60, 120);
    ctx.quadraticCurveTo(120, 60, 160, 120);
    ctx.fill();
  } else {
    ctx.fillStyle = "#f6efe4";
    ctx.fillRect(0, 0, 160, 120);
    for (const [x, y, r, color] of [[50, 60, 38, warm], [100, 52, 28, accent], [92, 84, 20, "#2f4058"]] as const) {
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  return texture(c);
}

/** The same "random" numbers every time, so the shelf of books doesn't change when the room is rebuilt. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

interface RoomOptions {
  palette: Palette;
  /** What stands in the room. */
  props: PropId[];
  /** What is seen through the window. */
  sky: Sky;
  /** Heights, measured from the middle of a seated head. */
  floor: number;
  tableTop: number;
  tableRadius: number;
  /** The rug reaches past the chairs. */
  rugRadius: number;
  centreZ: number;
  /** A picture of the wall (a URL) that replaces the painted wall, window, pictures and shelves once it has loaded. */
  backdrop?: string | null;
}

/** Width of the wall picture, in scene units. A little more than the width the camera sees. */
const BACKDROP_WIDTH = 19;

/** Walls, floor, rug, window with curtains, shelves, pictures, plant and a pendant lamp. */
export function buildRoom(kit: Kit, scene: THREE.Scene, { palette, props, sky: skyView, floor, tableTop, tableRadius, rugRadius, centreZ, backdrop }: RoomOptions): () => void {
  const { solid, flat, own } = kit;
  const wallZ = -10;
  const context: PropContext = { kit, scene, palette, floor, wallZ };

  // Wall and floor.
  const wall = flat(new THREE.PlaneGeometry(64, 18), new THREE.MeshBasicMaterial({ map: own(wallTexture(palette)) }));
  wall.position.set(0, floor + 8.4, wallZ);
  const ground = flat(new THREE.PlaneGeometry(64, 44), new THREE.MeshToonMaterial({ map: own(floorTexture(palette.floor)), gradientMap: kit.gradientMap }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, floor, -9);
  ground.receiveShadow = true;
  scene.add(ground);
  // Everything on the wall is kept together so a painted backdrop can take its place.
  const wallDecor = new THREE.Group();
  wallDecor.add(wall);
  scene.add(wallDecor);

  // Skirting board and crown moulding.
  const skirting = solid(new THREE.BoxGeometry(64, 0.35, 0.12), 0xffffff, { edge: 0, castShadow: false });
  skirting.position.set(0, floor + 0.18, wallZ + 0.06);
  const crown = solid(new THREE.BoxGeometry(64, 0.3, 0.16), 0xffffff, { edge: 0, castShadow: false });
  crown.position.set(0, floor + 7.5, wallZ + 0.08);
  wallDecor.add(skirting, crown);

  // A rug under the table.
  const rug = flat(new THREE.CircleGeometry(rugRadius, 64), new THREE.MeshToonMaterial({ map: own(rugTexture(palette.rug)), gradientMap: kit.gradientMap }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, floor + 0.012, centreZ);
  rug.receiveShadow = true;
  scene.add(rug);

  // A window with a sill and curtains.
  const windowX = -3.9;
  const windowY = floor + 5.4;
  const frame = solid(new THREE.BoxGeometry(3.5, 3.1, 0.2), 0xffffff, { edge: 1.01, castShadow: false });
  frame.position.set(windowX, windowY, wallZ + 0.1);
  const sky = flat(new THREE.PlaneGeometry(3.1, 2.7), new THREE.MeshBasicMaterial({ color: { day: 0xcfeaff, sunset: 0xf4a261, night: 0x1b2a4e }[skyView] }));
  sky.position.set(windowX, windowY, wallZ + 0.22);
  // The view: clouds by day, a low sun at sunset, a moon and stars at night.
  const view: THREE.Mesh[] = [];
  const dot = (radius: number, color: number, dx: number, dy: number, scaleX = 1, scaleY = 1) => {
    const mesh = flat(new THREE.CircleGeometry(radius, 20), new THREE.MeshBasicMaterial({ color }));
    mesh.scale.set(scaleX, scaleY, 1);
    mesh.position.set(windowX + dx, windowY + dy, wallZ + 0.23);
    view.push(mesh);
  };
  if (skyView === "day") dot(0.5, 0xffffff, -0.5, 0.5, 1.6, 0.6);
  else if (skyView === "sunset") {
    dot(0.45, 0xffe08a, 0.5, -0.7);
    dot(0.5, 0xffd6c0, -0.6, 0.55, 1.6, 0.5);
  } else {
    dot(0.28, 0xfff3c4, 0.6, 0.5);
    for (const [dx, dy] of [[-0.8, 0.7], [-0.3, 0.2], [0.1, 0.9], [-0.9, -0.4], [0.7, -0.3]]) dot(0.035, 0xffffff, dx, dy);
  }
  const bar = solid(new THREE.BoxGeometry(0.08, 2.7, 0.08), 0xffffff, { edge: 0, castShadow: false });
  bar.position.set(windowX, windowY, wallZ + 0.26);
  const crossbar = solid(new THREE.BoxGeometry(3.1, 0.08, 0.08), 0xffffff, { edge: 0, castShadow: false });
  crossbar.position.set(windowX, windowY, wallZ + 0.26);
  const sill = solid(new THREE.BoxGeometry(3.9, 0.14, 0.4), 0xffffff, { edge: 1.02, castShadow: false });
  sill.position.set(windowX, windowY - 1.62, wallZ + 0.25);
  wallDecor.add(frame, sky, ...view, bar, crossbar, sill);
  for (const side of [-1, 1]) {
    const curtain = solid(new RoundedBoxGeometry(0.75, 3.7, 0.3, 3, 0.14), palette.curtain, { edge: 1.03, castShadow: false });
    curtain.position.set(windowX + side * 2.05, windowY - 0.15, wallZ + 0.35);
    wallDecor.add(curtain);
  }
  const rod = solid(new THREE.CylinderGeometry(0.05, 0.05, 5.4, 10), 0x3a2a20, { edge: 0, castShadow: false });
  rod.rotation.z = Math.PI / 2;
  rod.position.set(windowX, windowY + 1.85, wallZ + 0.4);
  wallDecor.add(rod);

  // Two pictures, or a map or a television in their place.
  const wallProp = props.find((p): p is "map" | "tv" => WALL_PROPS.includes(p));
  if (wallProp) buildWallProp(wallProp, 4.4, { ...context, scene: wallDecor });
  for (const [x, w, h, kind] of wallProp ? [] : ([[3.3, 2.1, 1.6, "landscape"], [5.5, 1.3, 1.7, "abstract"]] as const)) {
    const picture = solid(new THREE.BoxGeometry(w + 0.24, h + 0.24, 0.12), 0x3a2a20, { edge: 1.01, castShadow: false });
    picture.position.set(x, floor + 5.6, wallZ + 0.1);
    const art = flat(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: own(artTexture(kind, palette)) }));
    art.position.set(x, floor + 5.6, wallZ + 0.18);
    wallDecor.add(picture, art);
  }

  // Whatever stands on the floor, at the two free places by the wall.
  props.filter((p): p is "guitar" | "ball" | "globe" | "suitcase" | "easel" => FLOOR_PROPS.includes(p)).slice(0, 2).forEach((id, i) => buildFloorProp(id, i === 0 ? -5.9 : 5.3, -8.4, context));

  // A bookcase full of books.
  const caseX = -8.3;
  const caseY = floor + 3.2;
  const shelf = solid(new THREE.BoxGeometry(2.6, 6.2, 0.7), 0x6f4a2e, { edge: 1.01, castShadow: false });
  shelf.position.set(caseX, caseY, wallZ + 0.4);
  if (props.includes("bookcase")) wallDecor.add(shelf);
  const random = seeded(7);
  const bookColors = [0xc0503a, 0x4aa3df, 0xf2c230, 0x6aa84f, 0x8e44ad, 0xe8e0d0, palette.lamp, palette.curtain];
  for (let row = 0; row < (props.includes("bookcase") ? 4 : 0); row++) {
    const shelfY = caseY - 2.6 + row * 1.55;
    const board = solid(new THREE.BoxGeometry(2.4, 0.1, 0.62), 0x8a6240, { edge: 0, castShadow: false });
    board.position.set(caseX, shelfY, wallZ + 0.45);
    wallDecor.add(board);
    let x = caseX - 1.1;
    while (x < caseX + 1.05) {
      const width = 0.11 + random() * 0.12;
      const height = 0.7 + random() * 0.55;
      const book = solid(new THREE.BoxGeometry(width, height, 0.4), bookColors[Math.floor(random() * bookColors.length)], { edge: 0, castShadow: false });
      book.position.set(x + width / 2, shelfY + 0.05 + height / 2, wallZ + 0.5);
      wallDecor.add(book);
      x += width + 0.01;
    }
  }

  // A plant by the right wall.
  const pot = solid(new THREE.CylinderGeometry(0.55, 0.4, 0.8, 20), 0xc0503a);
  pot.position.set(7.4, floor + 0.4, -7.5);
  if (props.includes("plant")) scene.add(pot);
  for (const [dx, dy, r] of props.includes("plant") ? ([[0, 1.05, 0.7], [-0.5, 1.5, 0.5], [0.5, 1.55, 0.52], [0, 2.0, 0.45], [-0.25, 1.1, 0.5]] as const) : []) {
    const leaves = solid(new THREE.SphereGeometry(r, 18, 14), palette.decor, { edge: 1.05 });
    leaves.position.set(7.4 + dx, floor + dy, -7.5);
    scene.add(leaves);
  }

  // A pendant lamp over the table, with a faint cone of light.
  const cord = solid(new THREE.CylinderGeometry(0.02, 0.02, 4, 6), 0x222222, { edge: 0, castShadow: false });
  cord.position.set(0, 4.4, centreZ);
  const shade = solid(new THREE.ConeGeometry(0.8, 0.55, 28, 1, true), palette.lamp, { edge: 1.04, castShadow: false });
  (shade.material as THREE.MeshToonMaterial).side = THREE.DoubleSide;
  shade.position.set(0, 2.6, centreZ);
  const bulb = flat(new THREE.SphereGeometry(0.2, 16, 12), new THREE.MeshBasicMaterial({ color: 0xfff2c0 }));
  bulb.position.set(0, 2.4, centreZ);
  const beam = flat(
    new THREE.ConeGeometry(tableRadius * 0.55, 2.4 - tableTop, 40, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffe2a8, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  beam.position.set(0, (2.4 + tableTop) / 2, centreZ);
  scene.add(cord, shade, bulb, beam);

  // A picture of the wall for the student's topic, painted by an image model. Until it arrives the painted wall stays.
  let cancelled = false;
  if (backdrop) {
    new THREE.TextureLoader().load(
      backdrop,
      (texture) => {
        if (cancelled) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        own(texture);
        const { width, height } = texture.image as { width: number; height: number };
        const planeHeight = BACKDROP_WIDTH * (height / width);
        const picture = flat(new THREE.PlaneGeometry(BACKDROP_WIDTH, planeHeight), new THREE.MeshBasicMaterial({ map: texture }));
        // Sunk a little below the floor, which hides the strip of floor that is often painted along the bottom.
        picture.position.set(0, floor - planeHeight * 0.06 + planeHeight / 2, wallZ + 0.02);
        scene.add(picture);
        wallDecor.visible = false;
      },
      undefined,
      () => {},
    );
  }
  return () => {
    cancelled = true;
  };
}

interface TableOptions {
  palette: Palette;
  props: PropId[];
  floor: number;
  tableTop: number;
  radius: number;
  centreZ: number;
}

/** A round wooden table with a rim, an apron, a pedestal and something in the middle: flowers, food or a laptop. */
export function buildTable(kit: Kit, scene: THREE.Scene, { palette, props, floor, tableTop, radius, centreZ }: TableOptions): void {
  const { solid, own } = kit;
  const grain = own(woodTexture());
  const top = solid(new THREE.CylinderGeometry(radius, radius, 0.14, 72), palette.table, { map: grain });
  top.position.set(0, tableTop - 0.07, centreZ);
  const rim = solid(new THREE.TorusGeometry(radius, 0.07, 12, 120), palette.rim, { edge: 0 });
  rim.rotation.x = Math.PI / 2;
  rim.position.set(0, tableTop - 0.07, centreZ);
  const apron = solid(new THREE.CylinderGeometry(radius - 0.35, radius - 0.35, 0.4, 72), palette.rim);
  apron.position.set(0, tableTop - 0.34, centreZ);
  const stem = solid(new THREE.CylinderGeometry(0.4, 0.5, tableTop - floor - 0.5, 24), palette.rim);
  stem.position.set(0, (tableTop - 0.5 + floor) / 2, centreZ);
  const foot = solid(new THREE.CylinderGeometry(1.3, 1.4, 0.16, 40), palette.rim);
  foot.position.set(0, floor + 0.08, centreZ);
  scene.add(top, rim, apron, stem, foot);

  buildCentrepiece(props.find((p): p is "flowers" | "food" | "laptop" => CENTREPIECES.includes(p)) ?? "flowers", tableTop, centreZ, { kit, scene, palette, floor, wallZ: -10 });
}
