import { ArrowLeft, Check, CheckCheck, Clapperboard, Eye, EyeOff, Loader2, Play, RotateCcw, Star, Video as VideoIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { resumePoint } from "@/api/progress";
import { BlurText } from "@/components/motion/BlurText";
import { FadeUp } from "@/components/motion/FadeUp";
import { ScrollReveal } from "@/components/motion/ScrollReveal";
import { useAddons } from "@/hooks/useAddons";
import { useMetaProgress } from "@/hooks/useMetaProgress";
import { episodeCode, progressShare } from "@/lib/episodes";
import { formatTime } from "@/lib/format";
import { typeLabel } from "@/lib/labels";
import {
  episodeNumber,
  formatDate,
  groupBySeason,
  isReleased,
  metaCast,
  metaDirectors,
  metaGenres,
  trailerYouTubeId,
} from "@/lib/meta";
import { streamsPath } from "@/lib/routes";
import { getMeta, type MetaDetail, type Video } from "@/lib/stremio";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export default function Detail() {
  const { type = "", id = "" } = useParams();
  const { active, loading: addonsLoading } = useAddons();
  const navigate = useNavigate();
  const [state, setState] = useState<{ key: string; meta: MetaDetail | null; source?: string } | null>(null);
  const key = `${type}|${id}`;

  useEffect(() => {
    if (addonsLoading) return;
    let cancelled = false;
    getMeta(active, type, id).then((result) => {
      if (!cancelled) setState({ key, meta: result?.meta ?? null, source: result?.addon.manifest.name });
    });
    return () => {
      cancelled = true;
    };
  }, [active, addonsLoading, type, id, key]);

  if (!state || state.key !== key) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!state.meta) {
    return (
      <div className="flex flex-col items-center gap-3 py-24 text-center">
        <Clapperboard className="size-8 text-muted-foreground" />
        <p className="font-medium">{t("No encontramos la ficha de este título")}</p>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("Ninguno de tus addons activos tiene información para él. Revisa que tengas un addon de metadatos (como Cinemeta) activo.")}
        </p>
        <Button variant="outline" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t("Volver")}
        </Button>
      </div>
    );
  }

  return <DetailView meta={state.meta} source={state.source} onBack={() => navigate(-1)} />;
}

function DetailView({ meta, source, onBack }: { meta: MetaDetail; source?: string; onBack: () => void }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const genres = metaGenres(meta);
  const cast = metaCast(meta).slice(0, 8);
  const directors = metaDirectors(meta);
  const trailer = trailerYouTubeId(meta);
  const year = meta.releaseInfo ?? meta.year;
  const isSeries = (meta.videos?.length ?? 0) > 0;
  const progress = useMetaProgress(meta);
  const movieVideoId = meta.behaviorHints?.defaultVideoId ?? meta.id;
  const movieProgress = progress.byVideo.get(movieVideoId);
  const movieResume = resumePoint(movieProgress);
  const movieCtx = { metaId: meta.id, type: meta.type, name: meta.name, poster: meta.poster };

  return (
    <div className="flex flex-col gap-8">
      {/* Hero: bleeds to the edges of the main column. */}
      <section className="relative -mx-4 -mt-6 overflow-hidden">
        {meta.background && (
          <img src={meta.background} alt="" className="absolute inset-0 size-full object-cover opacity-40" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/70 to-background/20" />
        <div className="relative flex flex-col gap-6 px-4 pb-6 pt-6 sm:flex-row sm:items-end sm:pt-24">
          {meta.poster && (
            <img src={meta.poster} alt="" className="hidden w-44 shrink-0 rounded-xl shadow-xl sm:block" />
          )}
          <div className="flex min-w-0 flex-col gap-4">
            <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
              <ArrowLeft />
              {t("Volver")}
            </Button>
            {meta.logo && !logoFailed ? (
              <img
                src={meta.logo}
                alt={meta.name}
                className="max-h-24 w-fit max-w-full object-contain object-left"
                onError={() => setLogoFailed(true)}
              />
            ) : (
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
                <BlurText text={meta.name} />
              </h1>
            )}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span>{typeLabel(meta.type)}</span>
              {year && <span>{year}</span>}
              {meta.runtime && <span>{meta.runtime}</span>}
              {meta.imdbRating && (
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Star className="size-4 fill-current text-yellow-400" />
                  {meta.imdbRating}
                </span>
              )}
            </div>
            {genres.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {genres.map((g) => (
                  <Badge key={g}>{g}</Badge>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {!isSeries && (
                <>
                  <Link to={streamsPath(meta.type, movieVideoId, meta.name, movieCtx)} className={buttonVariants({ size: "lg" })}>
                    <Play className="fill-current" />
                    {movieResume ? t("Continuar ({time})", { time: formatTime(movieResume) }) : t("Ver ahora")}
                  </Link>
                  {movieResume > 0 && (
                    <Link
                      to={`${streamsPath(meta.type, movieVideoId, meta.name, movieCtx)}&from=0`}
                      className={buttonVariants({ size: "lg", variant: "outline" })}
                    >
                      <RotateCcw />
                      {t("Desde el inicio")}
                    </Link>
                  )}
                  <Button
                    size="lg"
                    variant="outline"
                    onClick={() => progress.setWatched([{ id: movieVideoId }], !movieProgress?.watched)}
                  >
                    {movieProgress?.watched ? <Check /> : <Eye />}
                    {movieProgress?.watched ? t("Vista") : t("Marcar como vista")}
                  </Button>
                </>
              )}
              {trailer && (
                <a
                  href={`https://www.youtube.com/watch?v=${encodeURIComponent(trailer)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-5 text-sm font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <VideoIcon className="size-5" />
                  {t("Tráiler")}
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      <FadeUp delay={0.1}>
      <section className="grid gap-6 md:grid-cols-[2fr_1fr]">
        {meta.description && <p className="leading-relaxed text-foreground/90">{meta.description}</p>}
        <dl className="flex flex-col gap-3 text-sm">
          {directors.length > 0 && (
            <div>
              <dt className="text-muted-foreground">{t("Dirección")}</dt>
              <dd>{directors.join(", ")}</dd>
            </div>
          )}
          {cast.length > 0 && (
            <div>
              <dt className="text-muted-foreground">{t("Reparto")}</dt>
              <dd>{cast.join(", ")}</dd>
            </div>
          )}
          {source && (
            <div>
              <dt className="text-muted-foreground">{t("Ficha de")}</dt>
              <dd>{source}</dd>
            </div>
          )}
        </dl>
      </section>
      </FadeUp>

      {isSeries && (
        <ScrollReveal>
          <Episodes meta={meta} videos={meta.videos!} progress={progress} />
        </ScrollReveal>
      )}
    </div>
  );
}

function Episodes({
  meta,
  videos,
  progress,
}: {
  meta: MetaDetail;
  videos: Video[];
  progress: ReturnType<typeof useMetaProgress>;
}) {
  const seasons = groupBySeason(videos);
  const [season, setSeason] = useState(seasons[0]?.season ?? 1);
  // Once the progress arrives, open on the season you're in (only once,
  // so it doesn't fight the user's own tab clicks).
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || progress.byVideo.size === 0) return;
    jumped.current = true;
    const touched = videos.filter((v) => progress.byVideo.has(v.id) && (v.season ?? 0) > 0);
    if (touched.length) setSeason(Math.max(...touched.map((v) => v.season ?? 1)));
  }, [progress.byVideo, videos]);
  const current = seasons.find((s) => s.season === season) ?? seasons[0];
  const released = current.episodes.filter((v) => isReleased(v));
  const allWatched = released.length > 0 && released.every((v) => progress.byVideo.get(v.id)?.watched);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t("Episodios")}</h2>
        {released.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => progress.setWatched(released.map((v) => ({ id: v.id, video: v })), !allWatched)}
          >
            {allWatched ? <EyeOff /> : <CheckCheck />}
            {allWatched ? t("Marcar temporada como no vista") : t("Marcar temporada como vista")}
          </Button>
        )}
      </div>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist">
        {seasons.map((s) => (
          <button
            key={s.season}
            role="tab"
            aria-selected={s.season === current.season}
            onClick={() => setSeason(s.season)}
            className={cn(
              "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              s.season === current.season ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground",
            )}
          >
            {s.season === 0 ? t("Especiales") : t("Temporada {n}", { n: s.season })}
          </button>
        ))}
      </div>
      <ol className="flex flex-col gap-2">
        {current.episodes.map((v) => (
          <EpisodeItem
            key={v.id}
            video={v}
            meta={meta}
            entry={progress.byVideo.get(v.id)}
            onToggleWatched={(w) => progress.setWatched([{ id: v.id, video: v }], w)}
          />
        ))}
      </ol>
    </section>
  );
}

function EpisodeItem({
  video,
  meta,
  entry,
  onToggleWatched,
}: {
  video: Video;
  meta: MetaDetail;
  entry?: { watched: boolean; position: number; duration: number };
  onToggleWatched: (watched: boolean) => void;
}) {
  const [thumbFailed, setThumbFailed] = useState(false);
  const released = isReleased(video);
  const title = video.title ?? video.name ?? t("Episodio {n}", { n: episodeNumber(video) ?? "" });
  const overview = video.overview ?? video.description;
  const date = formatDate(video.released);
  const code = episodeCode(video.season, episodeNumber(video));
  const fullTitle = [meta.name, code, title].filter(Boolean).join(" · ");
  const watched = Boolean(entry?.watched);
  const share = entry && !watched ? progressShare(entry) : 0;
  const ctx = {
    metaId: meta.id,
    type: meta.type,
    name: meta.name,
    poster: meta.poster,
    season: video.season,
    episode: episodeNumber(video),
    episodeTitle: title,
  };

  return (
    <li className="flex items-center gap-1">
      <Link
        to={streamsPath(meta.type, video.id, fullTitle, ctx)}
        className={cn(
          "flex min-w-0 flex-1 gap-3 rounded-lg p-2 transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          !released && "opacity-60",
        )}
      >
        <div className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-md bg-muted sm:w-44">
          {video.thumbnail && !thumbFailed && (
            <img
              src={video.thumbnail}
              alt=""
              loading="lazy"
              className={cn("size-full object-cover", watched && "opacity-50")}
              onError={() => setThumbFailed(true)}
            />
          )}
          {watched && (
            <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="size-4" />
            </span>
          )}
          {share > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/60">
              <div className="h-full bg-primary" style={{ width: `${Math.max(4, share * 100)}%` }} />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-medium">
            {episodeNumber(video) !== undefined && <span className="text-muted-foreground">{episodeNumber(video)}. </span>}
            {title}
          </p>
          <p className="text-xs text-muted-foreground">
            {released ? date : t("Se estrena el {date}", { date: date ?? "" })}
            {share > 0 && entry ? ` · ${t("vas en {time}", { time: formatTime(entry.position) })}` : ""}
          </p>
          {overview && <p className="line-clamp-2 text-sm text-muted-foreground">{overview}</p>}
        </div>
      </Link>
      {released && (
        <Button
          variant="ghost"
          size="icon"
          className={watched ? "text-primary" : "text-muted-foreground"}
          onClick={() => onToggleWatched(!watched)}
          aria-label={watched ? t("Marcar {code} como no visto", { code }) : t("Marcar {code} como visto", { code })}
          title={watched ? t("Visto · clic para desmarcar") : t("Marcar como visto")}
        >
          {watched ? <Check /> : <Eye />}
        </Button>
      )}
    </li>
  );
}
