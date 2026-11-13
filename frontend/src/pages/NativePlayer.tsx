import { AlertTriangle, ArrowLeft, Check, Gauge, Languages, ListVideo, Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useLeaveFlow } from "@/lib/backNav";
import { saveProgress } from "@/api/progress";
import { Button } from "@/components/ui/button";
import { useProfiles } from "@/context/ProfileContext";
import { useAddons } from "@/hooks/useAddons";
import { useNextEpisode } from "@/hooks/useNextEpisode";
import { android, type NativeSubtitle } from "@/lib/android";
import { onRemoteBack } from "@/lib/spatialNav";
import { DebridProgress } from "@/components/player/DebridProgress";
import { languageInfo, streamLangLabel, subtitleLabel } from "@/lib/languages";
import { playerPath } from "@/lib/routes";
import { isDebridStream, isDubbedFor, isMultiAudio, languageOptions, markShortClip, placeholderMax, qualityOptions, type AltStream, type AudioChoice } from "@/lib/streams";
import { getSubtitles, type Extra, type Subtitle } from "@/lib/stremio";
import { chooseSubtitles, fetchSubtitleVtt, getSubsPref, getSubtitleSync, NO_SYNC, retimeVtt, saveSubtitleSync } from "@/lib/subtitles";
import type { PlayerState } from "./Streams";
import { t } from "@/i18n";

// Subtitles shouldn't hold the video back for long.
const SUBTITLES_WAIT_MS = 6000;
// The installed app moves subtitles itself (0.8.0+): send them untouched.
const nativeSync = android?.supports("subsync") ?? false;

/** The page's --primary (an oklch color) as #rrggbb, for the native player. */
function accentHex(): string | undefined {
  try {
    const color = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
    const ctx = document.createElement("canvas").getContext("2d");
    if (!color || !ctx) return undefined;
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return undefined;
  }
}

function choiceLabel(lang: AudioChoice) {
  return lang === "original" ? t("Original (sin doblaje marcado)") : streamLangLabel(lang);
}

/** Android app: hands the stream to the native player (ExoPlayer + ffmpeg),
 * which plays MKV/HEVC/AC3/DTS and has its own audio/subtitle menus. This
 * page waits behind it and saves the progress it reports. */
export function NativePlayer({ type, id, state }: { type: string; id: string; state: PlayerState }) {
  const navigate = useNavigate();
  const leave = useLeaveFlow();
  const { active } = useAddons();
  const { current } = useProfiles();
  const [status, setStatus] = useState<"preparing" | "playing" | "closed" | "error" | "placeholder" | "versions">("preparing");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const lastSaved = useRef(0);
  // To reopen the player where it was, with the same subtitles.
  const subsRef = useRef<NativeSubtitle[]>([]);
  const positionRef = useRef((state.startAt ?? 0) * 1000);

  const { stream, title, dubbed, startAt, progress, languages, alternatives = [] } = state;
  const language = current?.language ?? "es-419";
  // Other files of this title, like the web player's Idioma / Calidad menus.
  const langOptions = languageOptions(alternatives);
  const qualities = qualityOptions(alternatives, stream.url ?? "", languages, language);
  const hasVersions = langOptions.length > 1 || qualities.length > 1;
  const nextEp = useNextEpisode(active, type, progress);
  const nextRef = useRef(nextEp);
  nextRef.current = nextEp;

  /** Same title, another file, same minute (the page remounts per stream). */
  function switchTo(alt: AltStream) {
    if (alt.stream.url === stream.url) return launch(subsRef.current, positionRef.current);
    navigate(playerPath(type, id), {
      replace: true,
      state: {
        ...state,
        stream: alt.stream,
        languages: alt.languages,
        dubbed: isDubbedFor(alt.languages, language) && !isMultiAudio(alt.languages),
        startAt: positionRef.current / 1000,
        resumed: false,
      } satisfies PlayerState,
    });
  }

  async function save(positionMs: number, durationMs: number, force = false) {
    if (!progress || durationMs <= 0) return;
    const position = positionMs / 1000;
    const duration = durationMs / 1000;
    if (duration < placeholderMax(stream) || position < 5) return;
    if (!force && Math.abs(position - lastSaved.current) < 30) return;
    lastSaved.current = position;
    await saveProgress(id, progress, position, duration).catch(() => {});
  }

  function launch(subtitles: NativeSubtitle[], fromMs: number) {
    if (!android || !stream.url) return;
    subsRef.current = subtitles;
    const mode = current?.subtitles_mode ?? "auto";
    const pref = getSubsPref(current?.id);
    const subtitlesOn =
      mode === "always" ? true : mode === "off" ? false : pref === "on" || (!dubbed && pref !== "off");
    android.play({
      url: stream.url,
      headers: stream.behaviorHints?.proxyHeaders?.request,
      title,
      startMs: Math.round(fromMs),
      audioLanguages: [language, language.split("-")[0]],
      preferLatino: language === "es-419",
      subtitles,
      subtitlesOn,
      hasVersions,
      nextEpisode: nextRef.current?.code || undefined,
      accentColor: accentHex(),
      // Read now: the player may have changed it since the last launch.
      subtitleSync: nativeSync ? getSubtitleSync(id) : undefined,
    });
    setStatus("playing");
  }

  // Load subtitles (up to a few seconds), then start the native player.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      const extra: Extra = {};
      const hints = stream.behaviorHints;
      if (hints?.filename) extra.filename = hints.filename;
      if (hints?.videoSize) extra.videoSize = String(hints.videoSize);
      if (hints?.videoHash) extra.videoHash = hints.videoHash;
      const preferred = languageInfo(current?.subtitle_language ?? language).subtitles;
      const load = (async () => {
        const fromAddons = await getSubtitles(active, type, id, extra).catch(() => [] as Subtitle[]);
        const chosen = chooseSubtitles([...(stream.subtitles ?? []), ...fromAddons], preferred);
        const loaded = await Promise.all(
          chosen.map(async (s, i): Promise<NativeSubtitle | null> => {
            try {
              const vtt = await fetchSubtitleVtt(s.url);
              // Older installs can't move subtitles: send them already
              // shifted by the fix saved for this video (web/Mac player).
              const sync = nativeSync ? NO_SYNC : getSubtitleSync(id);
              return { label: `${subtitleLabel(s.lang)} ${i + 1}`, lang: s.lang, vtt: retimeVtt(vtt, sync.offset, sync.scale) };
            } catch {
              return null;
            }
          }),
        );
        return loaded.filter((s): s is NativeSubtitle => s !== null);
      })();
      const timeout = new Promise<NativeSubtitle[]>((resolve) => window.setTimeout(() => resolve([]), SUBTITLES_WAIT_MS));
      const subtitles = await Promise.race([load, timeout]);
      // The native player only gets "Siguiente episodio" at launch: give the
      // lookup (started at the same time) a moment to finish.
      for (let waited = 0; nextRef.current === undefined && waited < 4000; waited += 200) {
        await new Promise((r) => window.setTimeout(r, 200));
      }
      if (!cancelled) launch(subtitles, (startAt ?? 0) * 1000);
    })();
    return () => {
      cancelled = true;
    };
    // Once per stream (the page remounts for another one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back on the "Idioma y calidad" list: back to the video, same minute
  // (instead of leaving the title).
  useEffect(() => {
    if (status !== "versions") return;
    return onRemoteBack(() => {
      launch(subsRef.current, positionRef.current);
      return true;
    });
    // launch reads refs; re-register only when the screen changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    if (!android) return;
    return android.onPlayer((e) => {
      if (e.positionMs > 0) positionRef.current = e.positionMs;
      if (e.type === "progress") {
        void save(e.positionMs, e.durationMs);
      } else if (e.type === "closed") {
        if (e.durationMs > 0 && e.durationMs / 1000 < placeholderMax(stream)) {
          markShortClip(stream);
          setStatus("placeholder");
          return;
        }
        void save(e.positionMs, e.durationMs, true).finally(leave);
        setStatus("closed");
      } else if (e.type === "next") {
        const next = nextRef.current;
        setStatus("closed");
        void save(e.positionMs, e.durationMs, true).finally(() => (next ? navigate(next.href, { replace: true }) : leave()));
      } else if (e.type === "versions") {
        void save(e.positionMs, e.durationMs, true);
        setStatus("versions");
      } else if (e.type === "subsync") {
        // Timing fixed in the player: remembered for this video, everywhere
        // on this device (same as the web player's).
        try {
          const sync = JSON.parse(e.message ?? "{}") as { offset?: unknown; scale?: unknown };
          if (typeof sync.offset === "number" && typeof sync.scale === "number") {
            saveSubtitleSync(id, { offset: Math.round(sync.offset * 100) / 100, scale: sync.scale });
          }
        } catch {
          // ignore a malformed message
        }
      } else if (e.type === "error") {
        setError(e.message ?? null);
        setStatus("error");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-black p-6 text-center text-white">
      <button
        onClick={leave}
        className="absolute left-4 top-4 flex items-center gap-2 rounded-full px-3 py-2 text-sm text-white/80 hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline-none"
      >
        <ArrowLeft className="size-5" />
        {t("Volver")}
      </button>
      <p className="max-w-lg truncate text-lg font-semibold">{title}</p>

      {(status === "preparing" || status === "closed") && <Loader2 className="size-10 animate-spin text-white/70" />}

      {status === "playing" && (
        <Button size="lg" autoFocus onClick={() => launch(subsRef.current, positionRef.current)}>
          <Play />
          {t("Abrir el reproductor de nuevo")}
        </Button>
      )}

      {status === "placeholder" && (
        <div className="flex max-w-md flex-col items-center gap-4">
          <p className="text-white/80">
            {isDebridStream(stream)
              ? t("Tu debrid todavía está descargando este archivo. Vuelve a intentarlo en unos minutos o elige otro stream.")
              : t("Esta fuente devolvió un video muy corto, no el episodio o la película. Suele ser un aviso del addon (por ejemplo, que requiere su plan premium). Elige otra fuente.")}
          </p>
          {/* Debrid download progress; reopens the player when it's done. */}
          {isDebridStream(stream) && stream.url && (
            <DebridProgress
              url={stream.url}
              stream={stream}
              videoId={id}
              context={state.progress}
              onDirect={(direct) =>
                navigate(playerPath(type, id), { replace: true, state: { ...state, stream: { ...stream, url: direct } } })
              }
              onReady={() => launch(subsRef.current, (startAt ?? 0) * 1000)} />
          )}
          <Button size="lg" autoFocus onClick={() => navigate(-1)}>
            <ListVideo />
            {t("Elegir otro stream")}
          </Button>
        </div>
      )}

      {status === "versions" && (
        <div className="flex w-full max-w-md flex-col gap-4 text-left">
          {langOptions.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2 px-1 text-sm font-semibold text-white/70">
                <Languages className="size-4" />
                {t("Idioma")}
              </p>
              {langOptions.map((o, i) => {
                const isCurrent = o.alt.stream.url === stream.url;
                return (
                  <button
                    key={o.alt.stream.url ?? i}
                    autoFocus={isCurrent}
                    onClick={() => switchTo(o.alt)}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                  >
                    <Check className={`size-4 shrink-0 ${isCurrent ? "opacity-100" : "opacity-0"}`} />
                    <span className="flex-1">{o.langs.map(choiceLabel).join(" · ")}</span>
                    <span className="text-xs text-white/50">{[o.alt.quality, o.alt.size].filter(Boolean).join(" · ")}</span>
                  </button>
                );
              })}
            </div>
          )}
          {qualities.length > 1 && (
            <div className="flex flex-col gap-1">
              <p className="flex items-center gap-2 px-1 text-sm font-semibold text-white/70">
                <Gauge className="size-4" />
                {t("Calidad")}
              </p>
              {qualities.map((q, i) => (
                <button
                  key={q.alt.stream.url ?? i}
                  autoFocus={q.current && langOptions.length <= 1}
                  onClick={() => switchTo(q.alt)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-white/10 focus-visible:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  <Check className={`size-4 shrink-0 ${q.current ? "opacity-100" : "opacity-0"}`} />
                  <span className="flex-1">{q.quality ?? t("Calidad desconocida")}</span>
                  <span className="text-xs text-white/50">{q.alt.size}</span>
                </button>
              ))}
            </div>
          )}
          <Button size="lg" variant="outline" className="border-white/30 bg-transparent text-white hover:bg-white/10" onClick={() => launch(subsRef.current, positionRef.current)}>
            <Play />
            {t("Seguir viendo así")}
          </Button>
          <p className="text-center text-xs text-white/50">{t("Sigue desde el mismo minuto. Las pistas de un mismo archivo se cambian en ⚙ → Audio.")}</p>
        </div>
      )}

      {status === "error" && (
        <div className="flex max-w-md flex-col items-center gap-4">
          <AlertTriangle className="size-10 text-yellow-400" />
          <p className="text-white/80">{t("No se pudo reproducir este stream.")}</p>
          {error && <p className="break-words text-xs text-white/50">{error}</p>}
          <Button size="lg" autoFocus onClick={() => navigate(-1)}>
            <ListVideo />
            {t("Elegir otro stream")}
          </Button>
        </div>
      )}
    </div>
  );
}
