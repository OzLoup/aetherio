import { useEffect, useRef, useState, type RefObject } from "react";

export interface Playback {
  paused: boolean;
  currentTime: number;
  duration: number;
  /** End of the buffered range around the playhead (seconds). */
  buffered: number;
  volume: number;
  muted: boolean;
  /** Stalled waiting for data. */
  waiting: boolean;
}

/** Mirrors the <video> element's state for custom controls. `timeline`
 * maps it onto the real file when the desktop app streams it from a seek
 * point (the element's clock starts at 0 there). */
export function usePlayback(
  videoRef: RefObject<HTMLVideoElement | null>,
  timeline?: { offset: number; duration: number | null },
): Playback {
  const timelineRef = useRef(timeline);
  useEffect(() => {
    timelineRef.current = timeline;
  });
  const [state, setState] = useState<Playback>({
    paused: true,
    currentTime: 0,
    duration: 0,
    buffered: 0,
    volume: 1,
    muted: false,
    waiting: true,
  });

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const read = (waiting?: boolean) => {
      const offset = timelineRef.current?.offset ?? 0;
      let buffered = 0;
      for (let i = 0; i < v.buffered.length; i++) {
        if (v.buffered.start(i) <= v.currentTime + 0.5) buffered = Math.max(buffered, v.buffered.end(i));
      }
      setState((s) => ({
        paused: v.paused,
        currentTime: v.currentTime + offset,
        duration: timelineRef.current?.duration ?? (Number.isFinite(v.duration) ? v.duration : 0),
        buffered: buffered + offset,
        volume: v.volume,
        muted: v.muted,
        waiting: waiting ?? s.waiting,
      }));
    };
    const onAny = () => read();
    const onWaiting = () => read(true);
    const onFlowing = () => read(false);
    const events = ["play", "pause", "timeupdate", "durationchange", "progress", "volumechange", "seeked", "loadedmetadata"];
    events.forEach((e) => v.addEventListener(e, onAny));
    ["waiting", "seeking", "loadstart"].forEach((e) => v.addEventListener(e, onWaiting));
    ["playing", "canplay"].forEach((e) => v.addEventListener(e, onFlowing));
    return () => {
      events.forEach((e) => v.removeEventListener(e, onAny));
      ["waiting", "seeking", "loadstart"].forEach((e) => v.removeEventListener(e, onWaiting));
      ["playing", "canplay"].forEach((e) => v.removeEventListener(e, onFlowing));
    };
  }, [videoRef]);

  return state;
}
