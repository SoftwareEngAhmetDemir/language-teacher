import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import { MouthDriver } from "./lipSync";
import type { Rig } from "./rig";
import { loadVrmRig } from "./vrmRig";

interface Props {
  /** URL of the .vrm model file. */
  modelUrl: string;
  /** Tap on the teacher's audio; the mouth follows what is really being said. */
  analyser: AnalyserNode | null;
  /** The teacher is talking. Used to animate the mouth when there is no audio to analyse. */
  speaking: boolean;
  /** The teacher is waiting for the student to talk. */
  attentive: boolean;
}

/** A 3D teacher (VRM model on three.js) with lip sync, blinking, breathing, eye contact and head movement. */
export default function Avatar({ modelUrl, analyser, speaking, attentive }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef({ analyser, speaking, attentive });
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    latest.current = { analyser, speaking, attentive };
  });

  useEffect(() => {
    setStatus("loading");
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
    // The rig's origin is the middle of the head, so framing head and shoulders is the same for every model.
    camera.position.set(0, -0.03, 1.5);
    camera.lookAt(0, -0.03, 0);
    const key = new THREE.DirectionalLight(0xffffff, Math.PI * 0.9);
    key.position.set(0.8, 1.4, 2);
    scene.add(key, new THREE.AmbientLight(0xffffff, 0.9));

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

    let rig: Rig | undefined;
    let disposed = false;
    let frame = 0;
    loadVrmRig(modelUrl)
      .then((loaded) => {
        if (disposed) return loaded.dispose();
        rig = loaded;
        scene.add(loaded.object);
        setStatus("ready");
      })
      .catch((err) => {
        console.error("Could not load the teacher model", err);
        if (!disposed) setStatus("failed");
      });

    const driver = new MouthDriver();
    let last = performance.now();
    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (rig) {
        const state = latest.current;
        const { visemes, level } = driver.update(dt, state.analyser, state.speaking);
        // Look at the student: the camera.
        rig.update(dt, { visemes, level, speaking: state.speaking, attentive: state.attentive }, camera.position);
      }
      renderer.render(scene, camera);
    };
    render();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (rig) {
        scene.remove(rig.object);
        rig.dispose();
      }
      renderer.dispose();
    };
  }, [modelUrl]);

  return (
    <div className="avatar">
      <canvas ref={canvasRef} />
      {status === "loading" && <span className="avatar-note">{t("avatar.loading")}</span>}
      {status === "failed" && <span className="avatar-note">{t("avatar.teacherFailed")}</span>}
    </div>
  );
}
