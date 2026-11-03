import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { BlossomCarousel, BlossomNext, BlossomPrev } from "@blossom-carousel/react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getCatalog, type AddonRef, type Extra, type MetaPreview } from "@/lib/stremio";
import { CARD_WIDTH, PosterCard, PosterSkeleton } from "./PosterCard";
import { remoteMode } from "@/lib/spatialNav";
import { t } from "@/i18n";

const ROW_LIMIT = 24;
const ARROW =
  "hidden size-7 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted disabled:opacity-30 sm:inline-flex";

interface CatalogRowProps {
  title: string;
  subtitle?: string;
  addon: AddonRef;
  type: string;
  catalogId: string;
  extra?: Extra;
  /** "Ver todo" target. */
  seeAllHref?: string;
  /** Hide the row entirely when the catalog comes back empty (search). */
  hideWhenEmpty?: boolean;
  /** Called with the number of items once loaded (0 on error). */
  onLoaded?: (count: number) => void;
}

/** Horizontal row of posters. Loads only when scrolled near, so a profile
 * with many catalogs doesn't fire every request at once. */
export function CatalogRow({ title, subtitle, addon, type, catalogId, extra, seeAllHref, hideWhenEmpty, onLoaded }: CatalogRowProps) {
  const rootRef = useRef<HTMLElement>(null);
  const remote = remoteMode();
  const [visible, setVisible] = useState(false);
  const [items, setItems] = useState<MetaPreview[] | null>(null);
  const [failed, setFailed] = useState(false);
  const extraKey = JSON.stringify(extra ?? {});
  const carouselId = `row-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  // TV remote: the row can take focus while it loads; once the posters are
  // in, the focus moves to the one in the same column (so holding ↓ never
  // runs into a row with nothing to focus, and the focus stays put).
  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const load = useCallback(async () => {
    setFailed(false);
    setItems(null);
    try {
      const metas = await getCatalog(addon, type, catalogId, JSON.parse(extraKey) as Extra);
      setItems(metas.slice(0, ROW_LIMIT));
      onLoadedRef.current?.(metas.length);
    } catch {
      setFailed(true);
      onLoadedRef.current?.(0);
    }
  }, [addon, type, catalogId, extraKey]);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  // Focus was waiting on the loading row: hand it to the poster in the same
  // column (or the retry button if it failed).
  const waiting = useRef<number | null>(null);
  useEffect(() => {
    if (waiting.current === null || (!items && !failed)) return;
    const column = waiting.current;
    waiting.current = null;
    const posters = rootRef.current?.querySelectorAll<HTMLElement>("[data-blossom-slide]:not([data-see-all]) a");
    const target = posters?.length
      ? posters[Math.min(column, posters.length - 1)]
      : rootRef.current?.querySelector<HTMLElement>("[data-blossom-slide] a, button:not([tabindex='-1'])");
    target?.focus({ preventScroll: true });
  }, [items, failed]);

  if (hideWhenEmpty && items && items.length === 0) return null;
  const shape = items?.[0]?.posterShape ?? "poster";

  return (
    <section ref={rootRef} className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{title}</h2>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {seeAllHref && items && items.length > 0 && (
            <Link
              to={seeAllHref}
              tabIndex={remote ? -1 : undefined}
              className="rounded-md px-2 py-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("Ver todo")}
            </Link>
          )}
          <BlossomPrev for={carouselId} className={ARROW} aria-label={t("Anterior")} tabIndex={-1}>
            <ChevronLeft className="size-4" />
          </BlossomPrev>
          <BlossomNext for={carouselId} className={ARROW} aria-label={t("Siguiente")} tabIndex={-1}>
            <ChevronRight className="size-4" />
          </BlossomNext>
        </div>
      </div>

      {failed ? (
        <div className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {t("No se pudo cargar este catálogo.")}
          <Button variant="outline" size="sm" onClick={load}>
            <RotateCw />
            {t("Reintentar")}
          </Button>
        </div>
      ) : items && items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted-foreground">
          {t("Este catálogo está vacío.")}
        </p>
      ) : (
        // Blossom: native scroll (touch, trackpad, TV remote focus) plus
        // mouse drag with momentum on desktop.
        <BlossomCarousel id={carouselId} className="-mx-4 flex snap-x scroll-px-4 gap-3 px-4 pb-2 pt-1">
          {items
            ? items.map((m) => (
                <div key={m.id} data-blossom-slide className={`${CARD_WIDTH[m.posterShape ?? shape]} shrink-0 snap-start`}>
                  <PosterCard meta={m} />
                </div>
              ))
            : null}
          {items && remote && seeAllHref && items.length > 0 && (
            <div data-blossom-slide data-see-all className={`${CARD_WIDTH[shape]} shrink-0 snap-start`}>
              <Link
                to={seeAllHref}
                className="flex aspect-[2/3] w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-muted/40 text-sm font-medium text-primary"
              >
                <ChevronRight className="size-6" />
                {t("Ver todo")}
              </Link>
            </div>
          )}
          {items
            ? null
            : Array.from({ length: 8 }, (_, i) =>
                remote ? (
                  <div
                    key={i}
                    tabIndex={0}
                    aria-busy="true"
                    aria-label={t("Cargando {title}", { title })}
                    onFocus={() => {
                      waiting.current = i;
                      setVisible(true); // load now if it wasn't near yet
                    }}
                    onBlur={() => {
                      if (waiting.current === i) waiting.current = null;
                    }}
                    className={`${CARD_WIDTH.poster} shrink-0 rounded-lg`}
                  >
                    <PosterSkeleton className="w-full" />
                  </div>
                ) : (
                  <PosterSkeleton key={i} className={`${CARD_WIDTH.poster} shrink-0`} />
                ),
              )}
        </BlossomCarousel>
      )}
    </section>
  );
}
