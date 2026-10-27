import { languageInfo, type StreamLang } from "@/lib/languages";
import type { AddonRef, Stream } from "@/lib/stremio";

export type Quality = "4K" | "1080p" | "720p" | "480p";
export type PlayKind = "direct" | "hls" | "youtube" | "external" | "torrent";

export interface ParsedStream {
  key: string;
  stream: Stream;
  addonName: string;
  addonIndex: number;
  kind: PlayKind;
  quality: Quality | null;
  /** true = already in the debrid cache (starts right away), false = the
   * debrid service still has to download it, null = unknown. */
  cached: boolean | null;
  size: string | null;
  /** Audio languages (empty = not marked, usually the original). */
  languages: StreamLang[];
  /** Subtitle languages the release says it carries. */
  subtitleLanguages: StreamLang[];
  hevc: boolean;
  hdr: boolean;
  /** Audio the browser usually can't decode (AC3, E-AC3, DTS, TrueHD) and
   * no AAC track mentioned. Very common in Latino dubs (AC3 5.1). */
  audioRisk: boolean;
  /** Likely to fail in a browser (HEVC, HDR/DV, MKV, notWebReady). */
  webRisk: boolean;
  headline: string;
  details: string;
  filename?: string;
}

// Patterns tuned to how Torrentio and Comet describe results; they also put
// country flags in titles (🇲🇽 is how Latino audio usually shows up).
const LANG_PATTERNS: [StreamLang, RegExp][] = [
  ["latino", /🇲🇽|\blatino\b|\blat\b|\blatam\b|lat-?am|español latino|spanish \(?latin/i],
  // Only explicit Spain markers. Torrentio puts 🇪🇸 on ANY "Spanish", and
  // English-named releases say "Spanish" for Latino dubs too (Castlevania
  // "English Spanish" was Latino) — so those are generic "espanol".
  ["castellano", /castellano|\bcast\b|espa[ñn]a|\bspain\b|\bes-es\b|\bcastilian\b/i],
  ["espanol", /🇪🇸|\bspanish\b|español|\besp\b|\bspa\b/i],
  ["english", /🇬🇧|🇺🇸|\benglish\b|\beng\b/i],
  ["portugues", /🇧🇷|🇵🇹|portugu|\bdublado\b/i],
  ["japones", /🇯🇵|japanese|japon[eé]s|\bjpn\b|\bjap\b/i],
  ["multi", /\bmulti\b|\bdual\b|multi-?audio|dual-?audio/i],
];

const SUBTITLE_RELEASE =
  /multi(?:ple)?[\s._-]*sub|\bsubs?\b|subtitulad|subtitled|\bvose\b|\bvos\b|\bsub[\s._-]?(?:esp|spa|lat|eng)\b|\bsubbed\b/i;
const AUDIO_MARKED = /\bdual\b|multi[\s._-]*audio|dual[\s._-]*audio|\baudio\b|\blatino\b|castellano|doblad|dublad|\bdub\b/i;

function detectQuality(text: string): Quality | null {
  if (/2160p|\b4k\b|\buhd\b/i.test(text)) return "4K";
  if (/1080p|\bfhd\b/i.test(text)) return "1080p";
  if (/720p/i.test(text)) return "720p";
  if (/480p|\bsd\b/i.test(text)) return "480p";
  return null;
}

function detectCached(name: string): boolean | null {
  if (/\+\]|⚡|\[\w+\s*\+\s*\]/.test(name)) return true;
  if (/download|⬇|⏳/i.test(name)) return false;
  return null;
}

function kindOf(s: Stream): PlayKind | null {
  if (s.url) return /\.m3u8(\?|$)/i.test(s.url) ? "hls" : "direct";
  if (s.ytId) return "youtube";
  if (s.externalUrl) return "external";
  if (s.infoHash) return "torrent";
  return null;
}

export function parseStream(stream: Stream, addon: AddonRef, addonIndex: number, index: number): ParsedStream | null {
  const kind = kindOf(stream);
  if (!kind) return null;
  const name = stream.name ?? "";
  const details = stream.description ?? stream.title ?? "";
  const filename = stream.behaviorHints?.filename;
  const text = `${name}\n${details}\n${filename ?? ""}`;
  // Flags/language words in the file name or title, never in the addon name.
  const langText = `${details}\n${filename ?? ""}`;
  const detected = LANG_PATTERNS.filter(([, re]) => re.test(langText)).map(([lang]) => lang);
  // A specific variant makes the generic "Spanish" redundant.
  const genericIndex = detected.indexOf("espanol");
  if (genericIndex >= 0 && (detected.includes("latino") || detected.includes("castellano"))) {
    detected.splice(genericIndex, 1);
  }
  // Releases like "[Multiple Subtitle]" or "Subtitulado.Esp" list their
  // SUBTITLE languages, and addons turn those into flags. Unless the name
  // also says something about the audio, the audio is the original.
  // (Found by checking Real-Debrid's real track list: Japanese only.)
  const subtitleRelease = SUBTITLE_RELEASE.test(langText);
  const audioMarked = AUDIO_MARKED.test(langText);
  const languages = subtitleRelease && !audioMarked ? [] : detected;
  const subtitleLanguages = subtitleRelease ? detected.filter((l) => l !== "multi") : [];
  const hevc = /\bhevc\b|x265|h\.?265/i.test(text);
  const surround = /\b(e-?ac-?3|ac-?3|ddp?\+?\s?[257]\.1|dd\+|dts(-?hd)?|truehd|atmos)\b/i.test(text);
  const audioRisk = surround && !/\baac\b/i.test(text);
  const hdr = /\bhdr\b|hdr10|\bdv\b|dolby ?vision/i.test(text);
  const mkv = /\.mkv\b/i.test(text);
  const sizeMatch = text.match(/(\d+(?:[.,]\d+)?)\s?(GB|MB|GiB|MiB)\b/i);

  return {
    key: `${addonIndex}-${index}`,
    stream,
    addonName: addon.manifest.name,
    addonIndex,
    kind,
    quality: detectQuality(text),
    cached: detectCached(name),
    size: sizeMatch ? `${sizeMatch[1].replace(",", ".")} ${sizeMatch[2].toUpperCase().replace("I", "")}` : null,
    languages,
    subtitleLanguages,
    hevc,
    hdr,
    audioRisk,
    webRisk: kind === "direct" && (hevc || hdr || mkv || Boolean(stream.behaviorHints?.notWebReady)),
    headline: name.replace(/\s*\n\s*/g, " · ").trim() || addon.manifest.name,
    details,
    filename,
  };
}

/** Several audio languages in one file. Browsers play only its default
 * track, which is often the original — so "has Latino" isn't "sounds Latino". */
export function isMultiAudio(languages: StreamLang[]) {
  return languages.includes("multi") || languages.filter((l) => l !== "multi").length >= 2;
}

export function languageScore(s: ParsedStream, profileLanguage: string) {
  const scores = languageInfo(profileLanguage).streamScore;
  return Math.max(0, ...s.languages.map((l) => scores[l] ?? 0));
}

const PLAYABLE: PlayKind[] = ["direct", "hls"];

export function isPlayable(s: ParsedStream) {
  return PLAYABLE.includes(s.kind);
}

/** Best for this profile first: playable, own language, already cached,
 * browser-friendly; ties keep the addon's own order (they sort by quality). */
/** Ready to play now: in the debrid cache, or a direct link from an addon
 * that doesn't use a debrid (no cache marks at all). */
export function isReady(s: ParsedStream) {
  return s.cached !== false;
}

/** Best for this profile first. Same language and ready to play → the
 * addon the user put higher wins (e.g. a Latino-focused addon above
 * Torrentio). In the macOS app, format risks don't matter (it converts). */
const QUALITY_RANK: Record<Quality, number> = { "4K": 4, "1080p": 3, "720p": 2, "480p": 1 };

/** Above the profile's "calidad máxima" (max = no limit). */
export function overMaxQuality(s: Pick<ParsedStream, "quality">, maxQuality?: string) {
  if (!maxQuality || maxQuality === "max" || !s.quality) return false;
  return QUALITY_RANK[s.quality] > (QUALITY_RANK[maxQuality as Quality] ?? 99);
}

export function sortStreams(
  list: ParsedStream[],
  profileLanguage: string,
  opts: { desktop?: boolean; maxQuality?: string } = {},
) {
  const rank = (s: ParsedStream) => [
    isPlayable(s) ? 0 : 1,
    -languageScore(s, profileLanguage),
    isReady(s) ? 0 : 1,
    overMaxQuality(s, opts.maxQuality) ? 1 : 0,
    // Same language: a single-language file beats a multi-audio one —
    // except in the app, which picks the right track inside the file.
    !opts.desktop && isMultiAudio(s.languages) ? 1 : 0,
    s.addonIndex,
    opts.desktop ? 0 : (s.webRisk ? 1 : 0) + (s.audioRisk ? 1 : 0),
  ];
  return [...list].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
}

/** What the player keeps about the other streams of the same title, to
 * offer switching language mid-movie. */
export type AltStream = Pick<ParsedStream, "stream" | "languages" | "quality" | "size" | "cached" | "audioRisk" | "webRisk">;

export function toAlt(s: ParsedStream): AltStream {
  return {
    stream: s.stream,
    languages: s.languages,
    quality: s.quality,
    size: s.size,
    cached: s.cached,
    audioRisk: s.audioRisk,
    webRisk: s.webRisk,
  };
}

/** Is this audio already in the profile's language? */
export function isDubbedFor(languages: StreamLang[], profileLanguage: string) {
  const scores = languageInfo(profileLanguage).streamScore;
  // >= 2: the exact language, or generic "Spanish" for a Spanish profile.
  return languages.some((l) => (scores[l] ?? 0) >= 2);
}

export type AudioChoice = StreamLang | "original";

export interface LanguageOption {
  /** Languages this file covers (several for a multi-audio file). */
  langs: AudioChoice[];
  alt: AltStream;
  multi: boolean;
}

/** Best file per audio language, one menu entry per distinct file (input
 * already sorted best-first). Prefers single-language files, which really
 * sound in that language in a browser, and browser-friendly audio. Files
 * without language marks are usually the original version. Streams the
 * debrid still has to download are skipped. */
export function languageOptions(alts: AltStream[]): LanguageOption[] {
  const rank = (a: AltStream) => (a.audioRisk ? 2 : 0) + (isMultiAudio(a.languages) ? 1 : 0);
  const ordered = alts
    .filter((a) => a.cached !== false)
    .map((a, i) => ({ a, i }))
    .sort((x, y) => rank(x.a) - rank(y.a) || x.i - y.i)
    .map(({ a }) => a);

  const best = new Map<AudioChoice, AltStream>();
  for (const alt of ordered) {
    const langs: AudioChoice[] = alt.languages.filter((l) => l !== "multi");
    if (!langs.length) langs.push("original");
    for (const l of langs) if (!best.has(l)) best.set(l, alt);
  }

  const byFile = new Map<AltStream, AudioChoice[]>();
  for (const [lang, alt] of best) byFile.set(alt, [...(byFile.get(alt) ?? []), lang]);
  return [...byFile.entries()].map(([alt, langs]) => ({ langs, alt, multi: isMultiAudio(alt.languages) }));
}

const QUALITY_ORDER: (Quality | null)[] = ["4K", "1080p", "720p", "480p", null];

/** "2.4 GB" → MB, for comparing weights. */
export function sizeMb(size: string | null) {
  const m = size?.match(/([\d.]+)\s*(GB|MB)/i);
  if (!m) return null;
  return Number(m[1]) * (m[2].toUpperCase() === "GB" ? 1024 : 1);
}

/** Same audio language as the current file (or both unmarked). */
export function sameLanguage(a: AltStream, languages: StreamLang[] | undefined) {
  const mine = (languages ?? []).filter((l) => l !== "multi");
  const theirs = a.languages.filter((l) => l !== "multi");
  return mine.length ? theirs.some((l) => mine.includes(l)) : theirs.length === 0;
}

export interface QualityOption {
  alt: AltStream;
  quality: Quality | null;
  current: boolean;
}

/** Same "kind" of audio for switching quality: dubbed in the profile's
 * language ↔ dubbed, original ↔ original. File names rarely say the
 * original language, so matching exact tags hid almost every option. */
export function sameAudioKind(a: AltStream, languages: StreamLang[] | undefined, profileLanguage: string) {
  return isDubbedFor(a.languages, profileLanguage) === isDubbedFor(languages ?? [], profileLanguage);
}

/** One ready version per quality, same kind of audio, highest first
 * (alternatives are already sorted best-first). The current file is always
 * the entry of its quality. */
export function qualityOptions(
  alts: AltStream[],
  currentUrl: string,
  languages: StreamLang[] | undefined,
  profileLanguage = "es-419",
): QualityOption[] {
  const current = alts.find((a) => a.stream.url === currentUrl);
  const byQuality = new Map<Quality | null, AltStream>();
  if (current) byQuality.set(current.quality, current);
  for (const a of alts) {
    if (a.cached === false || !sameAudioKind(a, languages, profileLanguage) || byQuality.has(a.quality)) continue;
    byQuality.set(a.quality, a);
  }
  return QUALITY_ORDER.filter((q) => byQuality.has(q)).map((q) => ({
    alt: byQuality.get(q)!,
    quality: q,
    current: byQuality.get(q)!.stream.url === currentUrl,
  }));
}

/** The next lighter option than the one playing (for "your connection is slow"). */
export function lighterOption(options: QualityOption[]) {
  const i = options.findIndex((o) => o.current);
  if (i < 0) return null;
  const current = options[i];
  const currentMb = sizeMb(current.alt.size);
  // Lower quality first; with no quality tag, a clearly smaller file.
  return (
    options.slice(i + 1).find((o) => o.quality !== null) ??
    options.find((o) => !o.current && currentMb !== null && (sizeMb(o.alt.size) ?? Infinity) < currentMb * 0.7) ??
    null
  );
}
