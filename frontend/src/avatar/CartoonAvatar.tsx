import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as THREE from "three";
import type { Look } from "./characters";
import { createCartoonRig } from "./cartoonRig";
import { MouthDriver } from "./lipSync";

interface Props {
  look: Look;
  /** Tap on the teacher's audio; the mouth follows what is really being said. */
  analyser: AnalyserNode | null;
  /** The teacher is talking. Used to animate the mouth when there is no audio to analyse. */
  speaking: boolean;
  /** The teacher is waiting for the student to talk. */
  attentive: boolean;
}

/** One cartoon teacher in its own canvas. */
export default function CartoonAvatar({ look, analyser, speaking, attentive }: Props) {
  const { t } = useTranslation();
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

    const rig = createCartoonRig(look);
    scene.add(rig.object);

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

    const driver = new MouthDriver();
    let last = performance.now();
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      const state = latest.current;
      const { visemes, level } = driver.update(dt, state.analyser, state.speaking);
      rig.update(dt, { visemes, level, speaking: state.speaking, attentive: state.attentive });
      renderer.render(scene, camera);
    };
    render();

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      rig.dispose();
      renderer.dispose();
    };
  }, [look]);

  return (
    <div className="avatar">
      <canvas ref={canvasRef} />
      {failed && <span className="avatar-note">{t("avatar.teacherFailed")}</span>}
    </div>
  );
}
