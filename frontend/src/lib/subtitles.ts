import type { Subtitle } from "@/lib/stremio";
/** Turn an SRT (or VTT) file into a WebVTT blob URL for a <track>.
 * Decodes as UTF-8 and falls back to Windows-1252, the usual encoding of
 * older Spanish subtitles (otherwise "acción" shows up as "acci�n"). */
export async function subtitleToVttUrl(url: string, timeoutMs = 15000): Promise<string> {
  return URL.createObjectURL(new Blob([await fetchSubtitleVtt(url, timeoutMs)], { type: "text/vtt" }));
}

/** Download a subtitle file and return it as WebVTT text. */
export async function fetchSubtitleVtt(url: string, timeoutMs = 15000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bytes = await res.arrayBuffer();
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
    }
    return srtToVtt(text);
  } finally {
    clearTimeout(timer);
  }
}

export function srtToVtt(input: string): string {
  const text = input.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (text.trimStart().startsWith("WEBVTT")) return text;
  // Only SRT has "-->" timings; MicroDVD (.sub, frame-based) and others
  // would turn into garbage, so the caller skips them.
  if (!text.includes("-->")) throw new Error("unsupported subtitle format");
  const body = text
    // 00:01:02,345 --> 00:01:04,000  =>  00:01:02.345 --> 00:01:04.000
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, "$1.$2")
    // Drop SRT cue numbers (a line with only digits before a timing line).
    .replace(/^\d+\n(?=\d{1,2}:\d{2}:\d{2}\.\d+ -->)/gm, "")
    // SRT font tags aren't valid VTT.
    .replace(/<\/?font[^>]*>/gi, "");
  return `WEBVTT\n\n${body.trim()}\n`;
}

function parseTime(t: string) {
  const parts = t.trim().split(":").map(Number);
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
}

function formatTime(seconds: number) {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(sec)}.${pad(rest, 3)}`;
}

const TIMING = /^(\s*)((?:\d+:)?\d{1,2}:\d{2}\.\d{1,3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{1,3})(.*)$/;

/** Move every cue `delta` seconds (negative = earlier). Cues that end
 * before 0 are dropped. Used when the desktop app restarts the video at a
 * seek point: the player's clock restarts at 0 there. */
export function shiftVtt(vtt: string, delta: number): string {
  return retimeVtt(vtt, delta, 1);
}

/** Every cue at `time × scale + offset` (seconds). `scale` fixes subtitles
 * made for another frame rate (the gap grows as the video goes on);
 * `offset` a constant lead/lag. Cues that end before 0 are dropped. */
export function retimeVtt(vtt: string, offset: number, scale = 1): string {
  if (!offset && scale === 1) return vtt;
  const [header, ...blocks] = vtt.replace(/\r\n?/g, "\n").split(/\n\n+/);
  const out: string[] = [header];
  for (const block of blocks) {
    const lines = block.split("\n");
    const i = lines.findIndex((l) => TIMING.test(l));
    if (i < 0) {
      out.push(block); // NOTE/STYLE blocks
      continue;
    }
    const [, indent, start, end, settings] = lines[i].match(TIMING)!;
    const s = parseTime(start) * scale + offset;
    const e = parseTime(end) * scale + offset;
    if (e <= 0) continue;
    lines[i] = `${indent}${formatTime(Math.max(0, s))} --> ${formatTime(e)}${settings}`;
    out.push(lines.join("\n"));
  }
  return out.join("\n\n").trimEnd() + "\n";
}

/** Subtitle timing fix chosen in the player, remembered per video. */
export interface SubtitleSync {
  /** Seconds; positive = later. */
  offset: number;
  /** 1, or a frame-rate correction. */
  scale: number;
}

export const NO_SYNC: SubtitleSync = { offset: 0, scale: 1 };
// 25 fps (PAL) vs 23.976 fps (film): the usual mismatch between releases.
export const FPS_SCALES = [
  { scale: 1, label: "Normal" },
  { scale: 25 / 23.976, label: "Más lento (25 → 23.976 fps)" },
  { scale: 23.976 / 25, label: "Más rápido (23.976 → 25 fps)" },
] as const;

const syncKey = (videoId: string) => `ap_subsync_${videoId}`;

export function getSubtitleSync(videoId: string): SubtitleSync {
  try {
    const raw = JSON.parse(localStorage.getItem(syncKey(videoId)) ?? "null");
    if (raw && typeof raw.offset === "number" && typeof raw.scale === "number") return raw;
  } catch {
    // per-device convenience only
  }
  return NO_SYNC;
}

export function saveSubtitleSync(videoId: string, sync: SubtitleSync) {
  try {
    if (!sync.offset && sync.scale === 1) localStorage.removeItem(syncKey(videoId));
    else localStorage.setItem(syncKey(videoId), JSON.stringify(sync));
  } catch {
    // per-device convenience only
  }
}

const MAX_TRACKS = 8;

// Per profile and device: once someone turns subtitles off, don't switch
// them on by themselves next time (e.g. releases with burned-in subtitles).
const subsPrefKey = (profileId?: number) => `ap_subs_${profileId ?? 0}`;

export function getSubsPref(profileId?: number): "on" | "off" | null {
  try {
    const v = localStorage.getItem(subsPrefKey(profileId));
    return v === "on" || v === "off" ? v : null;
  } catch {
    return null;
  }
}

export function setSubsPref(profileId: number | undefined, value: "on" | "off") {
  try {
    localStorage.setItem(subsPrefKey(profileId), value);
  } catch {
    // Best-effort only.
  }
}

/** Pick which subtitles to load: profile language first, then English. */
export function chooseSubtitles(all: Subtitle[], preferred: string[]) {
  const rank = (s: Subtitle) => {
    const i = preferred.indexOf(s.lang.toLowerCase());
    if (i >= 0) return i;
    return ["eng", "en"].includes(s.lang.toLowerCase()) ? 100 : 1000;
  };
  const seen = new Set<string>();
  return all
    .filter((s) => rank(s) < 1000 && !seen.has(s.url) && seen.add(s.url))
    .sort((a, b) => rank(a) - rank(b))
    .slice(0, MAX_TRACKS);
}

