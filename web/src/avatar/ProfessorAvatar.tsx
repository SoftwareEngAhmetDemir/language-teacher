import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { MouthDriver } from "./lipSync";

interface Props {
  /** Tap on the teacher's audio; the mouth follows what is really being said. */
  analyser: AnalyserNode | null;
  /** The teacher is talking. Used to animate the mouth when there is no audio to analyse. */
  speaking: boolean;
  /** The teacher is waiting for the student to talk. */
  attentive: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Flat-shaded cartoon look: three light steps instead of a smooth gradient. */
function toonGradient(): THREE.DataTexture {
  const texture = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

/**
 * "Professor Whiskers": an original cartoon teacher built from simple shapes, with a big nose,
 * a handlebar moustache, glasses and a graduation cap. The mouth opens and rounds with the voice.
 */
export default function ProfessorAvatar({ analyser, speaking, attentive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ analyser, speaking, attentive });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latest.current = { analyser, speaking, attentive };
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(24, 1, 0.1, 50);
    camera.position.set(0, 0.2, 5.1);
    camera.lookAt(0, 0.04, 0);
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(1.5, 2.5, 4);
    scene.add(key, new THREE.AmbientLight(0xffffff, 1.1));

    // Materials and shapes shared by the parts below.
    const gradientMap = toonGradient();
    const toon = (color: number) => new THREE.MeshToonMaterial({ color, gradientMap });
    const outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x1b1b1b, side: THREE.BackSide });
    const ball = new THREE.SphereGeometry(1, 40, 28);
    const owned: { dispose(): void }[] = [gradientMap, outlineMaterial, ball];

    /** A part with a thick black cartoon outline (an enlarged back-facing copy behind it). */
    const part = (
      parent: THREE.Object3D,
      geometry: THREE.BufferGeometry,
      color: number,
      opts: { outline?: number } = {},
    ) => {
      const material = toon(color);
      owned.push(material);
      const mesh = new THREE.Mesh(geometry, material);
      if (opts.outline !== 0) {
        const outline = new THREE.Mesh(geometry, outlineMaterial);
        outline.scale.setScalar(opts.outline ?? 1.07);
        mesh.add(outline);
      }
      parent.add(mesh);
      return mesh;
    };
    const flat = (geometry: THREE.BufferGeometry) => (owned.push(geometry), geometry);

    const SKIN = 0xf3b284;
    const NOSE = 0xe58f73;
    const HAIR = 0x3a2415;

    const root = new THREE.Group();
    scene.add(root);

    // Body: green cardigan, white collar and a red bow tie.
    const body = new THREE.Group();
    root.add(body);
    part(body, ball, 0x2f9e78).scale.set(0.95, 0.72, 0.55);
    body.children[0].position.set(0, -1.35, 0);
    // Neck.
    part(body, flat(new THREE.CylinderGeometry(0.21, 0.24, 0.34, 20)), SKIN).position.set(0, -0.58, 0);
    const collar = part(body, flat(new THREE.TorusGeometry(0.3, 0.08, 12, 32)), 0xffffff);
    collar.position.set(0, -0.7, 0.04);
    collar.rotation.x = Math.PI / 2;
    collar.scale.set(1, 1, 0.8);
    const tie = new THREE.Group();
    tie.position.set(0, -0.8, 0.4);
    body.add(tie);
    for (const side of [-1, 1]) {
      const wing = part(tie, flat(new THREE.ConeGeometry(0.13, 0.26, 4)), 0xd62839);
      wing.rotation.z = (-side * Math.PI) / 2;
      wing.position.x = side * 0.14;
    }
    part(tie, ball, 0xb71c2c).scale.setScalar(0.07);

    // Neck pivot: the head turns and nods around here rather than around its own centre.
    const neck = new THREE.Group();
    neck.position.set(0, -0.72, 0);
    root.add(neck);
    const head = new THREE.Group();
    head.position.set(0, 0.72, 0);
    neck.add(head);

    part(head, ball, SKIN).scale.set(0.58, 0.54, 0.52);
    for (const side of [-1, 1]) {
      part(head, ball, SKIN).scale.setScalar(0.1);
      head.children[head.children.length - 1].position.set(side * 0.56, -0.02, 0);
    }

    // Big round nose.
    const nose = part(head, ball, NOSE);
    nose.scale.set(0.17, 0.15, 0.15);
    nose.position.set(0, -0.06, 0.5);

    // Eyes with pupils that can look around, and eyebrows.
    const eyes: THREE.Group[] = [];
    const pupils: THREE.Mesh[] = [];
    const brows: THREE.Mesh[] = [];
    const browGeometry = flat(new THREE.CapsuleGeometry(0.028, 0.14, 6, 10));
    for (const side of [-1, 1]) {
      const eye = new THREE.Group();
      eye.position.set(side * 0.2, 0.14, 0.46);
      head.add(eye);
      part(eye, ball, 0xffffff).scale.set(0.1, 0.125, 0.06);
      const pupil = part(eye, ball, 0x1b1b1b, { outline: 0 });
      pupil.scale.setScalar(0.05);
      pupil.position.z = 0.04;
      eyes.push(eye);
      pupils.push(pupil);

      // Round glasses.
      const frame = part(head, flat(new THREE.TorusGeometry(0.13, 0.017, 10, 36)), 0x2a2a2a, { outline: 0 });
      frame.position.set(side * 0.2, 0.14, 0.5);

      const brow = part(head, browGeometry, HAIR, { outline: 0 });
      brow.rotation.z = Math.PI / 2 + side * 0.18;
      brow.position.set(side * 0.2, 0.34, 0.47);
      brows.push(brow);
    }
    const bridge = part(head, flat(new THREE.CylinderGeometry(0.012, 0.012, 0.1, 6)), 0x2a2a2a, { outline: 0 });
    bridge.rotation.z = Math.PI / 2;
    bridge.position.set(0, 0.16, 0.5);

    // Handlebar moustache.
    const moustache = new THREE.Group();
    moustache.position.set(0, -0.19, 0.47);
    head.add(moustache);
    for (const side of [-1, 1]) {
      const half = part(moustache, ball, HAIR);
      half.scale.set(0.2, 0.075, 0.08);
      half.position.x = side * 0.15;
      half.rotation.z = side * 0.4;
      const tip = part(moustache, ball, HAIR);
      tip.scale.setScalar(0.05);
      tip.position.set(side * 0.33, 0.04, 0);
    }

    // Mouth: a dark opening whose size and roundness follow the vowel, and a smile for when it is shut.
    const mouth = new THREE.Group();
    mouth.position.set(0, -0.33, 0.4);
    head.add(mouth);
    const lips = part(mouth, ball, 0xc4515a, { outline: 0 });
    const opening = part(mouth, ball, 0x3d0a0f, { outline: 0 });
    const tongue = part(mouth, ball, 0xe8808a, { outline: 0 });
    const smile = part(mouth, flat(new THREE.TorusGeometry(0.13, 0.016, 8, 28, Math.PI)), 0x7a2630, { outline: 0 });
    smile.rotation.z = Math.PI;
    smile.position.set(0, 0.05, 0.06);

    // Graduation cap with a gold tassel.
    const cap = new THREE.Group();
    cap.position.set(0, 0.42, 0);
    cap.rotation.x = -0.12;
    head.add(cap);
    part(cap, flat(new THREE.CylinderGeometry(0.42, 0.46, 0.26, 28)), 0x1f2a5a).position.y = 0.06;
    const board = part(cap, flat(new THREE.BoxGeometry(1.2, 0.07, 1.2)), 0x161f45);
    board.position.y = 0.22;
    board.rotation.y = Math.PI / 4;
    const button = part(cap, ball, 0xf2c230, { outline: 0 });
    button.scale.setScalar(0.05);
    button.position.y = 0.27;
    const tassel = new THREE.Group();
    tassel.position.set(0.42, 0.23, 0.42);
    cap.add(tassel);
    part(tassel, flat(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 6)), 0xf2c230, { outline: 0 }).position.y = -0.15;
    part(tassel, flat(new THREE.CylinderGeometry(0.035, 0.06, 0.14, 10)), 0xf2c230, { outline: 0 }).position.y = -0.36;

    // Sideburns peeking out under the cap.
    for (const side of [-1, 1]) {
      const burn = part(head, ball, HAIR, { outline: 0 });
      burn.scale.set(0.06, 0.16, 0.1);
      burn.position.set(side * 0.5, 0.2, 0.12);
    }

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const driver = new MouthDriver();
    let last = performance.now();
    let t = 0;
    let nextBlink = rand(1.5, 4);
    let blinkStart = -1;
    let nextGaze = 0;
    const gazeFrom = new THREE.Vector2();
    const gazeTo = new THREE.Vector2();
    const gaze = new THREE.Vector2();
    let gazeBlend = 1;
    let smoothedLevel = 0;
    let frame = 0;

    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt;
      const state = latest.current;
      const motion = reduceMotion ? 0 : 1;
      const { visemes: v, level } = driver.update(dt, state.analyser, state.speaking);
      smoothedLevel += (level - smoothedLevel) * (1 - Math.exp(-dt / 0.12));

      // Mouth shape: tall for "ah", small and round for "oh" and "oo", wide and flat for "ee".
      const height = 0.02 + 0.22 * v.aa + 0.15 * v.oh + 0.09 * v.ou + 0.07 * v.ee + 0.04 * v.ih;
      const width = 0.13 + 0.05 * v.aa - 0.03 * v.oh - 0.05 * v.ou + 0.11 * v.ee + 0.08 * v.ih;
      const openAmount = Math.max(v.aa, v.oh, v.ou * 0.7, v.ee * 0.6, v.ih * 0.5);
      const isOpen = openAmount > 0.07;
      opening.visible = lips.visible = tongue.visible = isOpen;
      smile.visible = !isOpen;
      smile.scale.set(1 + (width - 0.13) * 2, 1, 1);
      lips.scale.set(width * 1.18, height * 1.25 + 0.01, 0.1);
      opening.scale.set(width, height, 0.12);
      tongue.scale.set(width * 0.6, height * 0.35, 0.1);
      tongue.position.y = -height * 0.45;
      tongue.position.z = 0.02;
      // The moustache rides up a little as the mouth opens and spreads.
      moustache.position.y = -0.19 + openAmount * 0.025;
      moustache.scale.x = 1 + v.ee * 0.06 - v.ou * 0.05;

      // Blink.
      if (blinkStart < 0 && t > nextBlink) blinkStart = t;
      let blink = 0;
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / 0.2;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = t + rand(2, 5.5);
        } else {
          blink = p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6;
        }
      }
      for (const eye of eyes) eye.scale.y = lerp(1, 0.08, blink);

      // Gaze: mostly at the student, shifting now and then.
      if (t > nextGaze) {
        gazeFrom.copy(gaze);
        gazeTo.set(rand(-0.6, 0.6), rand(-0.5, 0.4));
        gazeBlend = 0;
        nextGaze = t + rand(1.2, 3.5);
      }
      gazeBlend = Math.min(1, gazeBlend + dt / 0.12);
      gaze.lerpVectors(gazeFrom, gazeTo, gazeBlend);
      for (const pupil of pupils) {
        pupil.position.x = gaze.x * 0.03;
        pupil.position.y = gaze.y * 0.04;
      }

      // Eyebrows lift with the voice.
      for (const [i, brow] of brows.entries()) {
        brow.position.y = 0.34 + smoothedLevel * 0.04 + (state.attentive ? 0.025 : 0);
        brow.rotation.z = Math.PI / 2 + (i === 0 ? -0.18 : 0.18) + smoothedLevel * (i === 0 ? 0.1 : -0.1);
      }

      // Body: breathing, gentle sway, nodding with the voice, tilting the head when listening.
      body.scale.y = 1 + Math.sin(t * 1.5) * 0.008 * motion;
      neck.rotation.y = (Math.sin(t * 0.45) * 0.06 + Math.sin(t * 1.1) * 0.015) * motion;
      neck.rotation.z = (state.attentive ? 0.07 : 0.012 * Math.sin(t * 0.6)) * motion;
      neck.rotation.x = (Math.sin(t * 0.7) * 0.02 + smoothedLevel * 0.07 * Math.sin(t * 5)) * motion;
      tassel.rotation.z = Math.sin(t * 1.3 + neck.rotation.y * 4) * 0.12 * motion;

      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      owned.forEach((o) => o.dispose());
      renderer.dispose();
    };
  }, []);

  return (
    <div className="avatar">
      <canvas ref={canvasRef} />
      {failed && <span className="avatar-note">The 3D teacher couldn't load on this device.</span>}
    </div>
  );
}
