import { useEffect, useState } from "react";

// Echo cancellation takes the sound this page plays (the characters' voices) back out of what the microphone hears.
const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

/** A microphone that goes away is reopened after this pause, so one that keeps failing isn't retried in a tight loop. */
const REOPEN_DELAY_MS = 500;

/**
 * The microphone, opened by the page with the browser's echo cancellation, while `active`.
 *
 * Speech recognition opens the microphone without echo cancellation, so the characters' voices coming out of the
 * speakers drown out the student who talks over them. Given this track instead, recognition hears the student. `ready`
 * turns true once the track is open, or once opening it has failed: recognition then opens the microphone itself.
 */
export function useMicTrack(active: boolean): { track: MediaStreamTrack | null; ready: boolean } {
  const [track, setTrack] = useState<MediaStreamTrack | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!active) return;
    let closed = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    const release = (s: MediaStream | null) =>
      s?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });

    const open = async () => {
      try {
        const next = await navigator.mediaDevices.getUserMedia({ audio: MIC });
        if (closed) return release(next);
        release(stream);
        stream = next;
        const audio = next.getAudioTracks()[0];
        // Unplugged, or the system switched devices: open the microphone in use now.
        audio.onended = () => {
          if (!closed) timer = window.setTimeout(() => void open(), REOPEN_DELAY_MS);
        };
        setTrack(audio);
      } catch {
        if (!closed) setTrack(null);
      } finally {
        if (!closed) setReady(true);
      }
    };
    void open();

    return () => {
      closed = true;
      window.clearTimeout(timer);
      release(stream);
      setTrack(null);
      setReady(false);
    };
  }, [active]);

  return { track, ready };
}
