/** What this browser's <video> can play, for ranking and labeling streams.
 *
 * Every browser on iPhone/iPad (Safari, Edge, Chrome, Firefox) uses Apple's
 * WebKit engine, so they all share its limits: no MKV at all, but HEVC and
 * Dolby (AC3/E-AC3) audio do play. Chrome/Edge on a computer or Android is
 * the opposite: MKV with H.264 usually plays, AC3/DTS is silent. */
export interface MediaSupport {
  /** iPhone/iPad, any browser. */
  ios: boolean;
  /** MKV files (false = they won't even start). */
  mkv: boolean;
  /** Dolby Digital / Dolby Digital Plus audio. */
  ac3: boolean;
  hevc: boolean;
  /** HLS without hls.js (iPhone/Safari). */
  nativeHls: boolean;
}

function detectIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; touch gives it away.
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

function canPlay(video: HTMLVideoElement | null, type: string) {
  try {
    return Boolean(video?.canPlayType(type));
  } catch {
    return false;
  }
}

export function detectMediaSupport(): MediaSupport {
  const ios = detectIos();
  const video = typeof document === "undefined" ? null : document.createElement("video");
  return {
    ios,
    mkv: !ios,
    ac3: canPlay(video, 'audio/mp4; codecs="ac-3"') || canPlay(video, 'audio/mp4; codecs="ec-3"'),
    hevc: canPlay(video, 'video/mp4; codecs="hvc1.1.6.L93.B0"'),
    nativeHls: canPlay(video, "application/vnd.apple.mpegurl"),
  };
}

/** Desktop Chrome-like defaults (what the stream heuristics assumed so far). */
export const GENERIC_BROWSER: MediaSupport = { ios: false, mkv: true, ac3: false, hevc: false, nativeHls: false };

let cached: MediaSupport | undefined;
export function mediaSupport(): MediaSupport {
  return (cached ??= detectMediaSupport());
}
