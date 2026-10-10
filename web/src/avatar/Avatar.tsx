import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { MouthDriver } from "./lipSync";

const MODEL_URL = "/models/teacher.vrm";

interface Props {
  /** Tap on the teacher's audio; the mouth follows what is really being said. */
  analyser: AnalyserNode | null;
  /** The teacher is talking. Used to animate the mouth when there is no audio to analyse. */
  speaking: boolean;
  /** The teacher is waiting for the student to talk. */
  attentive: boolean;
}

const rand = (min: number, max: number) => min + Math.random() * (max - min);

/** A 3D teacher (VRM model on three.js) with lip sync, blinking, breathing, eye contact and head movement. */
export default function Avatar({ analyser, speaking, attentive }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ analyser, speaking, attentive });
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    latest.current = { analyser, speaking, attentive };
  });

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      setStatus("failed");
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(22, 1, 0.1, 20);
    const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
    key.position.set(0.8, 1.4, 2);
    scene.add(key, new THREE.AmbientLight(0xffffff, 0.9));

    // The eyes follow this point, which sits near the camera and drifts a little like a real gaze.
    const gaze = new THREE.Object3D();
    scene.add(gaze);

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
    let vrm: VRM | undefined;
    let disposed = false;
    let frame = 0;

    new GLTFLoader()
      .register((parser) => new VRMLoaderPlugin(parser))
      .loadAsync(MODEL_URL)
      .then((gltf) => {
        if (disposed) return;
        const model = gltf.userData.vrm as VRM;
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.rotateVRM0(model); // no-op for VRM 1.0 models, turns older ones to face the camera
        scene.add(model.scene);
        vrm = model;

        // Models load in a T-pose; let the arms hang.
        const arm = (name: "leftUpperArm" | "rightUpperArm", z: number) => {
          const bone = model.humanoid.getNormalizedBoneNode(name);
          if (bone) bone.rotation.z = z;
        };
        arm("leftUpperArm", -1.2);
        arm("rightUpperArm", 1.2);
        model.humanoid.update();

        // Frame head and shoulders.
        const head = new THREE.Vector3();
        model.humanoid.getNormalizedBoneNode("head")!.getWorldPosition(head);
        camera.position.set(head.x, head.y - 0.03, head.z + 1.5);
        camera.lookAt(head.x, head.y - 0.03, head.z);
        gaze.position.copy(camera.position);
        if (model.lookAt) model.lookAt.target = gaze;
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Could not load the teacher model", err);
        if (!disposed) setStatus("failed");
      });

    const mouth = new MouthDriver();
    let last = performance.now();
    let t = 0;
    let nextBlink = rand(1.5, 4);
    let blinkStart = -1;
    let nextGaze = 0;
    let gazeFrom = new THREE.Vector3();
    const gazeTarget = new THREE.Vector3();
    let gazeBlend = 1;
    let smoothedLevel = 0;

    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t += dt;
      if (!vrm) {
        renderer.render(scene, camera);
        return;
      }
      const state = latest.current;
      const expressions = vrm.expressionManager!;

      // Mouth: from the real audio when we have it, otherwise a syllable-paced stand-in.
      const { visemes, level } = mouth.update(dt, state.analyser, state.speaking);
      expressions.setValue("aa", visemes.aa);
      expressions.setValue("ih", visemes.ih);
      expressions.setValue("ou", visemes.ou);
      expressions.setValue("ee", visemes.ee);
      expressions.setValue("oh", visemes.oh);
      smoothedLevel += (level - smoothedLevel) * (1 - Math.exp(-dt / 0.12));

      // A slight smile while talking keeps the face friendly.
      const smile = state.speaking || smoothedLevel > 0.1 ? 0.25 : 0.12;
      expressions.setValue("happy", (expressions.getValue("happy") ?? 0) * 0.9 + smile * 0.1);

      // Blink every few seconds, quick down and a little slower up.
      if (blinkStart < 0 && t > nextBlink) blinkStart = t;
      if (blinkStart >= 0) {
        const p = (t - blinkStart) / 0.2;
        if (p >= 1) {
          blinkStart = -1;
          nextBlink = t + rand(2, 5.5);
          expressions.setValue("blink", 0);
        } else {
          expressions.setValue("blink", p < 0.4 ? p / 0.4 : 1 - (p - 0.4) / 0.6);
        }
      }

      // Eyes: look at the student, with small shifts of attention now and then.
      if (t > nextGaze) {
        gazeFrom = gaze.position.clone();
        gazeTarget.set(rand(-0.25, 0.25), rand(-0.15, 0.1), 0).add(camera.position);
        gazeBlend = 0;
        nextGaze = t + rand(1.2, 3.5);
      }
      gazeBlend = Math.min(1, gazeBlend + dt / 0.12);
      gaze.position.lerpVectors(gazeFrom, gazeTarget, gazeBlend);

      // Body: breathing, a gentle sway, nodding with the voice, tilting the head when listening.
      const motion = reduceMotion ? 0 : 1;
      const bone = (name: "head" | "neck" | "spine" | "chest") => vrm!.humanoid.getNormalizedBoneNode(name);
      const head = bone("head");
      const neck = bone("neck");
      const chest = bone("chest") ?? bone("spine");
      if (chest) chest.rotation.x = Math.sin(t * 1.5) * 0.012 * motion;
      if (neck) {
        neck.rotation.y = (Math.sin(t * 0.45) * 0.04 + Math.sin(t * 1.1) * 0.012) * motion;
        neck.rotation.z = (state.attentive ? 0.05 : 0.01 * Math.sin(t * 0.6)) * motion;
      }
      if (head) {
        head.rotation.x = (Math.sin(t * 0.7) * 0.015 + smoothedLevel * 0.05 * Math.sin(t * 5)) * motion;
        head.rotation.y = Math.sin(t * 0.33 + 1) * 0.03 * motion;
      }

      vrm.update(dt);
      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div className="avatar">
      <canvas ref={canvasRef} />
      {status === "loading" && <span className="avatar-note">Loading teacher…</span>}
      {status === "failed" && <span className="avatar-note">The 3D teacher couldn't load on this device.</span>}
    </div>
  );
}
