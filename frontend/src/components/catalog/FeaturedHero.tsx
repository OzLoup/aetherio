import { ChevronLeft, ChevronRight, Info, Play, Star } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { BlurText } from "@/components/motion/BlurText";
import { easeOutExpo, springs } from "@/components/motion/presets";
import { buttonVariants } from "@/components/ui/button";
import { typeLabel } from "@/lib/labels";
import { detailPath, streamsPath } from "@/lib/routes";
import { getCatalog, type AddonRef, type MetaPreview } from "@/lib/stremio";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

const COUNT = 9;
const AUTOPLAY_MS = 8000;

/**
 * "Destacados": a big hero for the active title plus a 3D cover flow of
 * posters. Cover flow math from Amicro's card-cover-flow (MIT), scaled up
 * for posters and made keyboard / remote friendly.
 */
export function FeaturedHero({ addon, type, catalogId }: { addon: AddonRef; type: string; catalogId: string }) {
  const [items, setItems] = useState<MetaPreview[]>([]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    getCatalog(addon, type, catalogId)
      .then((metas) => {
        if (cancelled) return;
        const good = metas.filter((m) => m.poster && m.background).slice(0, COUNT);
        setItems(good);
        setActive(Math.min(2, Math.max(0, good.length - 1)));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [addon, type, catalogId]);

  // Autoplay, paused while the user is on it (hover/focus) or tab hidden.
  useEffect(() => {
    if (reduce || paused || items.length < 2) return;
    const t = window.setInterval(() => {
      if (!document.hidden) setActive((i) => (i + 1) % items.length);
    }, AUTOPLAY_MS);
    return () => window.clearInterval(t);
  }, [reduce, paused, items.length]);

  if (!items.length) return null;
  const meta = items[active];
  const go = (i: number) => setActive(Math.max(0, Math.min(items.length - 1, i)));
  const genres = (meta.genres ?? meta.genre ?? []).slice(0, 3);
  const year = meta.releaseInfo ?? meta.year;
  const ctx = { metaId: meta.id, type: meta.type, name: meta.name, poster: meta.poster };
  const watchHref = meta.type === "movie" ? streamsPath(meta.type, meta.id, meta.name, ctx) : detailPath(meta.type, meta.id);

  return (
    <section
      ref={rootRef}
      aria-roledescription="carrusel"
      aria-label={t("Destacados")}
      className="relative -mx-4 -mt-6 overflow-hidden"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(e) => {
        if (!rootRef.current?.contains(e.relatedTarget as Node)) setPaused(false);
      }}
      onKeyDown={(e) => {
        // With a TV remote the arrows move focus (lib/spatialNav.ts); the
        // side arrows and dots change the slide.
        if (document.documentElement.dataset.remote !== undefined) return;
        if (e.key === "ArrowLeft") go(active - 1);
        else if (e.key === "ArrowRight") go(active + 1);
      }}
    >
      {/* Background crossfade */}
      <AnimatePresence initial={false}>
        <motion.img
          key={meta.id}
          src={meta.background}
          alt=""
          className="absolute inset-0 size-full object-cover"
          initial={{ opacity: 0, scale: 1.06 }}
          animate={{ opacity: 0.55, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.1, ease: easeOutExpo }}
        />
      </AnimatePresence>
      <div className="absolute inset-0 bg-gradient-to-r from-background via-background/75 to-background/10" />
      <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-background/30" />

      <div className="relative mx-auto flex min-h-[26rem] max-w-7xl flex-col gap-8 px-4 pb-10 pt-10 lg:min-h-[32rem] lg:flex-row lg:items-center">
        {/* Info about the active title */}
        <div className="flex min-w-0 flex-1 flex-col gap-4 lg:max-w-xl">
          <span className="text-xs font-semibold uppercase tracking-widest text-primary">Destacado · {typeLabel(meta.type)}</span>
          <h1 key={meta.id} className="text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
            <BlurText text={meta.name} />
          </h1>
          <motion.div
            key={`${meta.id}-info`}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.15, ease: easeOutExpo }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              {year && <span>{year}</span>}
              {meta.imdbRating && (
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Star className="size-4 fill-current text-yellow-400" />
                  {meta.imdbRating}
                </span>
              )}
              {genres.map((g) => (
                <span key={g}>{g}</span>
              ))}
            </div>
            {meta.description && <p className="line-clamp-3 max-w-prose text-foreground/85">{meta.description}</p>}
            <div className="flex flex-wrap gap-2">
              <Link to={watchHref} className={buttonVariants({ size: "lg" })}>
                <Play className="fill-current" />
                {t("Ver ahora")}
              </Link>
              <Link to={detailPath(meta.type, meta.id)} className={buttonVariants({ size: "lg", variant: "outline" })}>
                <Info />
                {t("Más información")}
              </Link>
            </div>
          </motion.div>
        </div>

        {/* Cover flow */}
        <div className="flex flex-1 flex-col items-center gap-5">
          <div className="relative hidden h-72 w-full items-center justify-center [transform-style:preserve-3d] sm:flex" style={{ perspective: 1200 }}>
            {items.map((item, i) => {
              const offset = i - active;
              const abs = Math.abs(offset);
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  onClick={() => go(i)}
                  tabIndex={-1}
                  aria-hidden={i !== active}
                  className="absolute aspect-[2/3] w-40 cursor-pointer rounded-xl focus-visible:outline-none lg:w-44"
                  initial={false}
                  animate={{
                    x: offset * 92,
                    rotateY: offset === 0 ? 0 : offset < 0 ? 38 : -38,
                    z: offset === 0 ? 60 : -abs * 60,
                    scale: offset === 0 ? 1.08 : 1 - abs * 0.07,
                    opacity: abs > 3 ? 0 : 1 - abs * 0.2,
                  }}
                  transition={springs.smooth}
                  style={{ zIndex: 100 - abs, pointerEvents: abs > 3 ? "none" : "auto" }}
                >
                  <img
                    src={item.poster}
                    alt=""
                    className={cn(
                      "size-full rounded-xl object-cover shadow-2xl ring-1 ring-white/10",
                      offset === 0 && "ring-2 ring-primary/70",
                    )}
                  />
                </motion.button>
              );
            })}
          </div>

          {/* Controls */}
          <div className="flex items-center gap-2 rounded-full border border-border bg-card/70 px-1.5 py-1 backdrop-blur">
            <button
              type="button"
              onClick={() => go(active - 1)}
              disabled={active === 0}
              className="rounded-full p-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              aria-label={t("Anterior destacado")}
            >
              <ChevronLeft className="size-4" />
            </button>
            <div className="flex items-center gap-1.5">
              {items.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => go(i)}
                  aria-label={t("Ver {name}", { name: item.name })}
                  aria-current={i === active}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    i === active ? "w-5 bg-foreground" : "w-1.5 bg-foreground/30 hover:bg-foreground/60",
                  )}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={() => go(active + 1)}
              disabled={active === items.length - 1}
              className="rounded-full p-1.5 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
              aria-label={t("Siguiente destacado")}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
