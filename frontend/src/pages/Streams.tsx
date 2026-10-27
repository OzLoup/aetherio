import { ArrowLeft, Loader2, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { StreamCard } from "@/components/streams/StreamCard";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { useProfiles } from "@/context/ProfileContext";
import { useAddons } from "@/hooks/useAddons";
import { languageInfo } from "@/lib/languages";
import { getVideoProgress, resumePoint, type ProgressContext } from "@/api/progress";
import { playerPath, progressContextFrom } from "@/lib/routes";
import { isDubbedFor, isMultiAudio, isPlayable, isReady, parseStream, sortStreams, toAlt, type AltStream, type ParsedStream, type Quality } from "@/lib/streams";
import type { StreamLang } from "@/lib/languages";
import { desktop, probeMedia, verifiedLanguages } from "@/lib/desktop";
import { addonsFor, getStreams, type AddonResult, type Stream } from "@/lib/stremio";
import { t } from "@/i18n";

export interface PlayerState {
  stream: Stream;
  title: string;
  /** The stream already has the profile's language as audio (dubbed). */
  dubbed: boolean;
  /** Audio languages detected for this stream. */
  languages: StreamLang[];
  /** Other playable streams of the same title, best first (language switch). */
  alternatives: AltStream[];
  /** Resume here (seconds), when switching streams mid-playback. */
  startAt?: number;
  /** Send it straight to the TV (switched to a TV-friendly stream while casting). */
  castOnStart?: boolean;
  /** For saving progress (Continuar viendo, history, watched marks). */
  progress?: ProgressContext;
  /** Resuming a previous session: show "Continuando desde…". */
  resumed?: boolean;
}

const MAX_ALTERNATIVES = 60;
// How many ready streams the macOS app checks for their real audio tracks.
const VERIFY_LIMIT = 8;

const QUALITIES: Quality[] = ["4K", "1080p", "720p", "480p"];

export default function Streams() {
  const { type = "", id = "" } = useParams();
  const [params] = useSearchParams();
  const title = params.get("title") ?? "";
  const progress = useMemo(() => progressContextFrom(params, type, id), [params, type, id]);
  // "?from=0": "Desde el inicio" on the detail page.
  const forceStart = params.get("from") === "0";
  const navigate = useNavigate();
  const { active, loading: addonsLoading } = useAddons();
  const { current } = useProfiles();
  const language = current?.language ?? "es-419";
  const langLabel = t(languageInfo(language).label);

  const sources = useMemo(() => addonsFor(active, "stream", type, id), [active, type, id]);
  const [results, setResults] = useState<AddonResult<Stream>[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [onlyMyLanguage, setOnlyMyLanguage] = useState<boolean | null>(null);
  const [quality, setQuality] = useState<Quality | "">("");
  const [onlyCached, setOnlyCached] = useState(false);
  const [confirmUncached, setConfirmUncached] = useState<ParsedStream | null>(null);

  useEffect(() => {
    if (addonsLoading) return;
    let cancelled = false;
    setResults([]);
    getStreams(sources, type, id, (r) => {
      if (!cancelled) setResults((prev) => [...prev.filter((p) => p.addon !== r.addon), r]);
    });
    return () => {
      cancelled = true;
    };
  }, [sources, addonsLoading, type, id, attempt]);

  // macOS app: real audio languages of the first ready streams (by URL).
  // `verified` updates live (badges); `applied` re-sorts once per batch so
  // the list doesn't jump around while you're about to click.
  const [verified, setVerified] = useState<Record<string, StreamLang[] | null>>({});
  const [applied, setApplied] = useState<Record<string, StreamLang[] | null>>({});

  const parsed = useMemo(() => {
    const list = results.flatMap((r) =>
      r.items.map((s, i) => parseStream(s, r.addon, sources.indexOf(r.addon), i)).filter((s): s is ParsedStream => s !== null),
    );
    const withVerified = list.map((s) => {
      const real = s.stream.url ? applied[s.stream.url] : undefined;
      return real && real.length ? { ...s, languages: real } : s;
    });
    return sortStreams(withVerified, language, { desktop: Boolean(desktop), maxQuality: current?.max_quality });
  }, [results, sources, language, applied, current?.max_quality]);

  const allAnswered = sources.length > 0 && sources.every((a) => results.some((r) => r.addon === a));
  const probed = useRef(new Set<string>());
  useEffect(() => {
    if (!desktop || !allAnswered) return;
    // Only streams that are ready: probing an uncached one would make the
    // debrid start downloading something you may never watch.
    const candidates = parsed
      .filter((s) => isPlayable(s) && isReady(s) && s.stream.url && !probed.current.has(s.stream.url))
      .slice(0, Math.max(0, VERIFY_LIMIT - probed.current.size));
    if (!candidates.length) return;
    candidates.forEach((s) => probed.current.add(s.stream.url!));
    let cancelled = false;
    const found: Record<string, StreamLang[] | null> = {};
    (async () => {
      const queue = [...candidates];
      const worker = async () => {
        for (let s = queue.shift(); s; s = queue.shift()) {
          const url = s.stream.url!;
          let langs: StreamLang[] | null = null;
          try {
            langs = verifiedLanguages(await probeMedia(url, s.stream.behaviorHints?.proxyHeaders?.request));
          } catch {
            langs = null;
          }
          found[url] = langs;
          if (!cancelled) setVerified((v) => ({ ...v, [url]: langs }));
        }
      };
      await Promise.all([worker(), worker()]);
      if (!cancelled) setApplied((a) => ({ ...a, ...found }));
    })();
    return () => {
      cancelled = true;
      // Interrupted (e.g. React's dev double-mount): let the next run retry
      // whatever didn't finish (the local server caches finished probes).
      candidates.forEach((c) => {
        if (!(c.stream.url! in found)) probed.current.delete(c.stream.url!);
      });
    };
  }, [allAnswered, parsed]);

  // Exact language only: a Latino profile filtering "latino" shouldn't get
  // Castellano (that's only a fallback in the ordering).
  const hasMyLanguage = parsed.some((s) => isDubbedFor(s.languages, language));
  // Default the language filter on once we know there's something in it.
  const myLanguageFilter = onlyMyLanguage ?? hasMyLanguage;
  const visible = parsed.filter(
    (s) =>
      (!myLanguageFilter || isDubbedFor(s.languages, language)) &&
      (!quality || s.quality === quality) &&
      (!onlyCached || s.cached === true),
  );
  const readyAlternative = parsed.find(
    (s) => s.cached === true && (s.kind === "direct" || s.kind === "hls") && (!hasMyLanguage || isDubbedFor(s.languages, language)),
  );
  const pending = sources.filter((a) => !results.some((r) => r.addon === a));
  const failed = results.filter((r) => r.error);

  async function play(s: ParsedStream) {
    // Picked up on another device or earlier: resume there.
    const saved = forceStart ? null : await getVideoProgress(id).catch(() => null);
    const startAt = resumePoint(saved);
    const state: PlayerState = {
      stream: s.stream,
      title,
      progress,
      startAt: startAt || undefined,
      resumed: startAt > 0,
      // A multi-audio file may well play its original track.
      dubbed: isDubbedFor(s.languages, language) && !isMultiAudio(s.languages),
      languages: (s.stream.url && verified[s.stream.url]?.length ? verified[s.stream.url] : null) ?? s.languages,
      alternatives: parsed.filter(isPlayable).slice(0, MAX_ALTERNATIVES).map(toAlt),
    };
    navigate(playerPath(type, id), { state });
  }

  function handleSelect(s: ParsedStream) {
    if ((s.kind === "direct" || s.kind === "hls") && s.cached === false) {
      setConfirmUncached(s);
    } else if (s.kind === "youtube") {
      window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(s.stream.ytId!)}`, "_blank", "noreferrer");
    } else if (s.kind === "external") {
      window.open(s.stream.externalUrl, "_blank", "noreferrer");
    } else if (s.kind === "direct" || s.kind === "hls") {
      play(s);
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t("Volver")}
        </Button>
        <h1 className="text-2xl font-bold tracking-tight">{title || "Elegir stream"}</h1>
      </div>

      {!addonsLoading && sources.length === 0 ? (
        <NoStreamAddons />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={myLanguageFilter} onCheckedChange={setOnlyMyLanguage} />
              {t("Solo {lang}", { lang: langLabel.toLowerCase() })}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={onlyCached} onCheckedChange={setOnlyCached} />
              {t("Solo listos para ver")}
            </label>
            <div className="ml-auto flex items-center gap-2">
              <Label htmlFor="q">{t("Calidad")}</Label>
              <NativeSelect id="q" value={quality} onChange={(e) => setQuality(e.target.value as Quality | "")} className="w-28">
                <option value="">{t("Todas")}</option>
                {QUALITIES.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>

          {pending.length > 0 && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("Buscando en {addons}…", { addons: pending.map((a) => a.manifest.name).join(", ") })}
            </p>
          )}
          {failed.length > 0 && (
            <p className="flex flex-wrap items-center gap-2 text-sm text-warning">
              {failed.map((r) => `${r.addon.manifest.name} ${r.error}`).join(" · ")}
              <Button variant="outline" size="sm" onClick={() => setAttempt((n) => n + 1)}>
                <RotateCw />
                {t("Reintentar")}
              </Button>
            </p>
          )}
          {!hasMyLanguage && pending.length === 0 && parsed.length > 0 && (
            <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
              {t("No encontramos streams en {lang}. Se muestran todos (los más cercanos a tu idioma primero) y los subtítulos en tu idioma se activarán solos.", { lang: langLabel.toLowerCase() })}
            </p>
          )}

          {visible.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {visible.map((s) => (
                <StreamCard
                  key={s.key}
                  s={s}
                  onSelect={handleSelect}
                  verified={s.stream.url ? verified[s.stream.url] : undefined}
                  verifying={Boolean(desktop && s.stream.url && probed.current.has(s.stream.url) && !(s.stream.url in verified))}
                />
              ))}
            </ul>
          ) : (
            pending.length === 0 && (
              <p className="py-12 text-center text-sm text-muted-foreground">
                {parsed.length ? t("Ningún stream coincide con estos filtros.") : t("No se encontraron streams para este título.")}
              </p>
            )
          )}
        </>
      )}

      <Dialog open={confirmUncached !== null} onOpenChange={(open) => !open && setConfirmUncached(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("Este stream todavía no está listo")}</DialogTitle>
            <DialogDescription>
              {t("No está en la caché de Real-Debrid. Si lo eliges, Real-Debrid empezará a descargarlo y podrás verlo cuando termine (de minutos a horas). Los marcados con ⚡ Listo empiezan al instante.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => confirmUncached && play(confirmUncached)}>
              {t("Pedir descarga")}
            </Button>
            {readyAlternative ? (
              <Button
                onClick={() => {
                  setConfirmUncached(null);
                  play(readyAlternative);
                }}
              >
                {t("Ver uno listo ({info})", { info: [readyAlternative.quality ?? "?", readyAlternative.size].filter(Boolean).join(" · ") })}
              </Button>
            ) : (
              <Button onClick={() => setConfirmUncached(null)}>{t("Elegir otro")}</Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function NoStreamAddons() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-6 text-sm">
      <p className="text-base font-semibold">{t("Ningún addon de este perfil trae streams")}</p>
      <p className="text-muted-foreground">
        {t("Para ver contenido necesitas un addon de streams, por ejemplo Torrentio o Comet configurado con tu cuenta de Real-Debrid:")}
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
        <li>
          {t("Abre la")}{" "}
          <a href="https://torrentio.strem.fun/configure" target="_blank" rel="noreferrer" className="text-primary underline">
            {t("página de configuración de Torrentio")}
          </a>
          .
        </li>
        <li>{t("Elige Real-Debrid, pega tu API key y, si quieres, prioriza el idioma español.")}</li>
        <li>{t("Copia la URL de instalación (la que termina en manifest.json).")}</li>
        <li>
          {t("Pégala en")}{" "}
          <Link to="/addons" className="text-primary underline">
            {t("Addons → Instalar addon")}
          </Link>
          .
        </li>
      </ol>
    </div>
  );
}
