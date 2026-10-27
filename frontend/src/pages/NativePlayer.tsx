import { AlertTriangle, ArrowLeft, ListVideo, Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { saveProgress } from "@/api/progress";
import { Button } from "@/components/ui/button";
import { useProfiles } from "@/context/ProfileContext";
import { useAddons } from "@/hooks/useAddons";
import { android, type NativeSubtitle } from "@/lib/android";
import { languageInfo, subtitleLabel } from "@/lib/languages";
import { getSubtitles, type Extra, type Subtitle } from "@/lib/stremio";
import { chooseSubtitles, fetchSubtitleVtt, getSubsPref } from "@/lib/subtitles";
import type { PlayerState } from "./Streams";
import { t } from "@/i18n";

// Subtitles shouldn't hold the video back for long.
const SUBTITLES_WAIT_MS = 6000;
// Torrentio's "downloading" placeholder is ~30 s; no movie/episode is this short.
const PLACEHOLDER_MAX_S = 90;

/** Android app: hands the stream to the native player (ExoPlayer + ffmpeg),
 * which plays MKV/HEVC/AC3/DTS and has its own audio/subtitle menus. This
 * page waits behind it and saves the progress it reports. */
export function NativePlayer({ type, id, state }: { type: string; id: string; state: PlayerState }) {
  const navigate = useNavigate();
  const { active } = useAddons();
  const { current } = useProfiles();
  const [status, setStatus] = useState<"preparing" | "playing" | "closed" | "error" | "placeholder">("preparing");
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const lastSaved = useRef(0);
  // To reopen the player where it was, with the same subtitles.
  const subsRef = useRef<NativeSubtitle[]>([]);
  const positionRef = useRef((state.startAt ?? 0) * 1000);

  const { stream, title, dubbed, startAt, progress } = state;
  const language = current?.language ?? "es-419";

  async function save(positionMs: number, durationMs: number, force = false) {
    if (!progress || durationMs <= 0) return;
    const position = positionMs / 1000;
    const duration = durationMs / 1000;
    if (duration < PLACEHOLDER_MAX_S || position < 5) return;
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
              return { label: `${subtitleLabel(s.lang)} ${i + 1}`, lang: s.lang, vtt: await fetchSubtitleVtt(s.url) };
            } catch {
              return null;
            }
          }),
        );
        return loaded.filter((s): s is NativeSubtitle => s !== null);
      })();
      const timeout = new Promise<NativeSubtitle[]>((resolve) => window.setTimeout(() => resolve([]), SUBTITLES_WAIT_MS));
      const subtitles = await Promise.race([load, timeout]);
      if (!cancelled) launch(subtitles, (startAt ?? 0) * 1000);
    })();
    return () => {
      cancelled = true;
    };
    // Once per stream (the page remounts for another one).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!android) return;
    return android.onPlayer((e) => {
      if (e.positionMs > 0) positionRef.current = e.positionMs;
      if (e.type === "progress") {
        void save(e.positionMs, e.durationMs);
      } else if (e.type === "closed") {
        if (e.durationMs > 0 && e.durationMs / 1000 < PLACEHOLDER_MAX_S) {
          setStatus("placeholder");
          return;
        }
        void save(e.positionMs, e.durationMs, true).finally(() => navigate(-1));
        setStatus("closed");
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
        onClick={() => navigate(-1)}
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
            {t("Tu debrid todavía está descargando este archivo. Vuelve a intentarlo en unos minutos o elige otro stream.")}
          </p>
          <Button size="lg" autoFocus onClick={() => navigate(-1)}>
            <ListVideo />
            {t("Elegir otro stream")}
          </Button>
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
