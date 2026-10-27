import { useCallback, useEffect, useRef } from "react";
import { getProfileId, getToken, API_BASE_URL } from "@/api/client";
import { saveProgress, type ProgressContext } from "@/api/progress";

interface Options {
  videoId: string;
  ctx?: ProgressContext;
  /** Real position/duration (desktop timeline or the TV's when casting). */
  position: number;
  duration: number;
  paused: boolean;
  /** False for placeholders / errors: nothing worth saving. */
  enabled: boolean;
}

const EVERY_MS = 60_000;

/** Saves progress on pause, on leaving, at the end and about once a minute —
 * sparse on purpose, so the database can sleep between saves. */
export function useProgressSaver({ videoId, ctx, position, duration, paused, enabled }: Options) {
  const latest = useRef({ position, duration, enabled, ctx });
  useEffect(() => {
    latest.current = { position, duration, enabled, ctx };
  });
  const lastSaved = useRef<number | null>(null);

  const save = useCallback(
    (force: boolean) => {
      const { position: p, duration: d, enabled: on, ctx: c } = latest.current;
      // Live TV has no end (Infinity): nothing to resume.
      if (!on || !c || !Number.isFinite(d) || d < 90 || p < 5) return;
      if (!force && lastSaved.current !== null && Math.abs(p - lastSaved.current) < 15) return;
      lastSaved.current = p;
      saveProgress(videoId, c, p, d).catch((err) => console.warn("[progress] save failed", err));
    },
    [videoId],
  );

  // While playing: about once a minute.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (!latest.current.enabled) return;
      save(false);
    }, EVERY_MS);
    return () => window.clearInterval(timer);
  }, [save]);

  // On pause.
  useEffect(() => {
    if (paused) save(true);
  }, [paused, save]);

  // Leaving the player (in-app navigation) or closing the window/tab.
  useEffect(() => {
    const onHide = () => {
      const { position: p, duration: d, enabled: on, ctx: c } = latest.current;
      // Live TV has no end (Infinity): nothing to resume.
      if (!on || !c || !Number.isFinite(d) || d < 90 || p < 5) return;
      // keepalive: survives the page going away (axios can't do that).
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getToken();
      const profile = getProfileId();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (profile) headers["X-Profile-Id"] = String(profile);
      fetch(`${API_BASE_URL}/progress/video/${encodeURIComponent(videoId)}`, {
        method: "PUT",
        keepalive: true,
        headers,
        body: JSON.stringify({
          meta_id: c.metaId,
          type: c.type,
          name: c.name,
          poster: c.poster ?? null,
          season: c.season ?? null,
          episode: c.episode ?? null,
          episode_title: c.episodeTitle ?? null,
          position: p,
          duration: d,
        }),
      }).catch(() => {});
    };
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      save(true);
    };
  }, [save, videoId]);

  return { saveNow: () => save(true) };
}
