/**
 * Bridge to the Android app (android/): the same web UI inside a WebView,
 * with videos handed to a native player (ExoPlayer + ffmpeg) that plays
 * MKV, HEVC, AC3/DTS and lets you pick the audio track inside the file.
 * `android` is undefined everywhere else.
 */

interface AndroidBridge {
  openExternal(url: string): void;
  /** JSON of NativePlayRequest. */
  play(request: string): void;
  isTv(): boolean;
  version(): string;
  /** JSON list of features; missing on installs older than 0.8.0. */
  features?(): string;
}

export interface NativeSubtitle {
  label: string;
  lang: string;
  /** WebVTT text (already converted and decoded by the web side). */
  vtt: string;
}

export interface NativePlayRequest {
  url: string;
  headers?: Record<string, string>;
  title: string;
  startMs: number;
  /** ISO codes in order of preference, e.g. ["es-419", "es"]. */
  audioLanguages: string[];
  /** Prefer an audio track whose name says "Latino". */
  preferLatino: boolean;
  subtitles: NativeSubtitle[];
  subtitlesOn: boolean;
  /** Show "Idioma y calidad" (other files of this title). */
  hasVersions: boolean;
  /** The profile's UI color (#rrggbb) for the player's buttons and bar. */
  accentColor?: string;
  /** "Siguiente episodio" button label (e.g. "T1E3"); absent = no next episode. */
  nextEpisode?: string;
  /** Subtitle timing to start with (feature "subsync": the subtitles go
   * as they are and the player moves them). */
  subtitleSync?: { offset: number; scale: number };
}

/** Sent by the native player: every ~15 s, on pause, and when closing. */
export interface NativePlayerEvent {
  /** versions = the user asked for another language/quality; next = next
   * episode; subsync = new subtitle timing (message: {"offset", "scale"}). */
  type: "progress" | "closed" | "error" | "versions" | "next" | "subsync";
  positionMs: number;
  durationMs: number;
  message?: string;
}

declare global {
  interface Window {
    AetherAndroid?: AndroidBridge;
  }
}

const bridge = typeof window === "undefined" ? undefined : window.AetherAndroid;

function features(): string[] {
  try {
    const list: unknown = JSON.parse(bridge?.features?.() ?? "[]");
    return Array.isArray(list) ? list.map(String) : [];
  } catch {
    return [];
  }
}

function listen<T>(name: string, callback: (detail: T) => void) {
  const listener = (e: Event) => callback((e as CustomEvent<T>).detail);
  window.addEventListener(name, listener);
  return () => window.removeEventListener(name, listener);
}

export const android = bridge
  ? {
      isTv: () => bridge.isTv(),
      version: () => bridge.version(),
      /** Whether the installed app has a feature (older installs lack some). */
      supports: (feature: "subsync") => features().includes(feature),
      openExternal: async (url: string) => bridge.openExternal(url),
      /** Google login result coming back through aetherio:// (same shape as the Mac app). */
      onAuth: (callback: (payload: { token: string | null; error: string | null }) => void) =>
        listen("aether:auth", callback),
      play: (request: NativePlayRequest) => bridge.play(JSON.stringify(request)),
      onPlayer: (callback: (event: NativePlayerEvent) => void) => listen("aether:player", callback),
    }
  : undefined;
