import { useEffect, useMemo, useState } from "react";
import { presetStyle, styleFromServer, type SceneStyle } from "../avatar/sceneStyle";
import { fetchBackdrop, fetchSceneStyle } from "../lib/api";

const PREPARE_TIMEOUT_MS = 35_000;

/**
 * The room a single teacher sits in. A ready-made scene is available at once; for the student's own topic the server
 * designs the room and paints its back wall, which takes a few seconds, so `painting` is true meanwhile. When the
 * picture cannot be made the standard room is used and `pictureFailed` is set.
 */
export function useRoom(sceneId: string, topic: string, enabled: boolean) {
  const [custom, setCustom] = useState<SceneStyle | null>(null);
  const [backdrop, setBackdrop] = useState<string | null>(null);
  const [painting, setPainting] = useState(false);
  const [pictureFailed, setPictureFailed] = useState(false);

  useEffect(() => {
    setCustom(null);
    setBackdrop(null);
    setPictureFailed(false);
    if (!enabled || !topic) {
      setPainting(false);
      return;
    }
    const controller = new AbortController();
    let url: string | null = null;
    setPainting(true);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(PREPARE_TIMEOUT_MS)]);
    void (async () => {
      const [style, picture] = await Promise.allSettled([
        fetchSceneStyle(topic, signal),
        // A picture that cannot be read as an image counts as a failure, like one that never arrives.
        fetchBackdrop(topic, signal).then(async (blob) => (await createImageBitmap(blob).then((bitmap) => bitmap.close()), blob)),
      ]);
      if (controller.signal.aborted) return; // Another topic was chosen, or the teacher was hidden.
      setCustom(style.status === "fulfilled" ? styleFromServer(style.value) : null);
      if (picture.status === "fulfilled") {
        url = URL.createObjectURL(picture.value);
        setBackdrop(url);
      } else {
        setPictureFailed(true);
      }
      setPainting(false);
    })();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [topic, enabled]);

  const style = useMemo(() => custom ?? presetStyle(sceneId || undefined), [custom, sceneId]);
  return { style, backdrop, painting, pictureFailed };
}
