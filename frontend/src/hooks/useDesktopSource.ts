import { useCallback, useEffect, useRef, useState } from "react";
import {
  canPlayDirect,
  desktop,
  pickAudioTrack,
  probeMedia,
  seekpoint,
  streamUrl,
  type ProbeInfo,
} from "@/lib/desktop";

type Status = "off" | "probing" | "ready" | "placeholder" | "error";

interface Options {
  /** False on the website, or while something else drives the player. */
  enabled: boolean;
  url: string;
  headers?: Record<string, string>;
  /** Profile language: picks the audio track (es-419 → "Latino"). */
  language: string;
  /** Resume here (seconds). */
  startAt?: number;
}

/**
 * In the macOS app, decides how to play a stream:
 * - "direct": the original file (simple MP4/AAC, one audio track)
 * - "server": through the local ffmpeg server, which copies the video,
 *   converts the chosen audio track to AAC and starts at `offset`.
 * In server mode the <video> clock restarts at 0 on every seek, so the
 * player adds `offset` to it (and shifts subtitles by it).
 */
export function useDesktopSource({ enabled, url, headers, language, startAt }: Options) {
  const active = enabled && Boolean(desktop);
  const [status, setStatus] = useState<Status>(active ? "probing" : "off");
  const [info, setInfo] = useState<ProbeInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [server, setServer] = useState(false);
  const [audio, setAudio] = useState(0);
  const [offset, setOffset] = useState(0);
  const [videoMode, setVideoMode] = useState<"copy" | "h264">("copy");
  const [attempt, setAttempt] = useState(0);
  const headersKey = JSON.stringify(headers ?? {});
  const startRef = useRef(startAt);

  useEffect(() => {
    if (!active) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    setStatus("probing");
    setError(null);
    const h = JSON.parse(headersKey) as Record<string, string>;
    (async () => {
      try {
        const probe = await probeMedia(url, h, attempt > 0);
        if (cancelled) return;
        console.info("[desktop] probe", probe);
        // HLS: ffprobe lists one audio per quality level — not real language
        // choices — and switching would send it through ffmpeg, losing the
        // levels. hls.js handles HLS audio/quality itself.
        if (/hls|applehttp/.test(probe.container ?? "")) {
          probe.audio = [];
          probe.subtitles = [];
        }
        setInfo(probe);
        // Torrentio's "being downloaded to debrid" clip is ~30 s.
        if (probe.duration && probe.duration < 90) {
          setStatus("placeholder");
          return;
        }
        const track = probe.audio.length ? pickAudioTrack(probe.audio, language) : 0;
        // HLS plays directly (hls.js): going through ffmpeg would flatten its
        // quality levels into one and lose adaptive bitrate.
        const isHls = /hls|applehttp/.test(probe.container ?? "");
        const viaServer = Boolean(Object.keys(h).length) || (!isHls && !canPlayDirect(probe, track));
        setAudio(track);
        setServer(viaServer);
        const at = startRef.current ?? 0;
        startRef.current = undefined;
        setOffset(viaServer && at > 0 ? await seekpoint(url, h, at) : 0);
        if (!cancelled) setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.warn("[desktop] probe failed", err);
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, url, headersKey, language, attempt]);

  const h = JSON.parse(headersKey) as Record<string, string>;

  /** Seek in server mode: restart ffmpeg at the keyframe before `t`. */
  const seekTo = useCallback(
    async (t: number) => {
      const target = Math.max(0, info?.duration ? Math.min(t, info.duration - 1) : t);
      // Re-encoded video can start anywhere; copied video only on keyframes.
      setOffset(videoMode === "h264" ? target : await seekpoint(url, JSON.parse(headersKey), target));
    },
    [info, url, headersKey, videoMode],
  );

  /** Switch audio track (keeps the current minute). */
  const selectAudio = useCallback(
    async (order: number, at: number) => {
      setAudio(order);
      setServer(true);
      setOffset(at > 0 ? (videoMode === "h264" ? at : await seekpoint(url, JSON.parse(headersKey), at)) : 0);
    },
    [url, headersKey, videoMode],
  );

  /** The original wouldn't play: go through the local server instead. */
  const forceServer = useCallback(
    async (at: number) => {
      setServer(true);
      setOffset(at > 0 ? await seekpoint(url, JSON.parse(headersKey), at) : 0);
    },
    [url, headersKey],
  );

  /** The video codec doesn't decode here: re-encode it (hardware H.264). */
  const reencodeVideo = useCallback((at: number) => {
    setServer(true);
    setVideoMode("h264");
    setOffset(at);
  }, []);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  let srcUrl: string | null = null;
  // Couldn't analyze the file (e.g. an HLS playlist): just play it.
  if (status === "error") srcUrl = url;
  if (status === "ready") {
    srcUrl = server ? streamUrl(url, h, { audio, start: offset, videoCodec: info?.video?.codec, videoMode }) : url;
  }

  return {
    active,
    status,
    info,
    error,
    server: status === "ready" && server,
    srcUrl,
    offset: server ? offset : 0,
    duration: server ? (info?.duration ?? null) : null,
    audio,
    videoMode,
    seekTo,
    selectAudio,
    forceServer,
    reencodeVideo,
    retry,
  };
}
