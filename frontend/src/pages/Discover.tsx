import { Loader2, RotateCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PosterGrid, PosterGridSkeleton } from "@/components/catalog/PosterGrid";
import { SuggestedAddons } from "@/components/catalog/SuggestedAddons";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useAddons } from "@/hooks/useAddons";
import { typeLabel } from "@/lib/labels";
import { catalogExtraNames, genreOptions, hideAdult, getCatalog, isDebridLibraryCatalog, requiredExtraNames, type Extra, type MetaPreview } from "@/lib/stremio";
import { t } from "@/i18n";

const TYPE_ORDER = ["movie", "series"];

/** Browse one catalog at a time with type / catalog / genre filters.
 * Filters live in the URL so the back button and "Ver todo" links work. */
export default function Discover() {
  const { active, loading: addonsLoading } = useAddons();
  const [params, setParams] = useSearchParams();

  // Catalogs that can be browsed with these filters: the only required extra
  // we know how to fill is `genre` (we pick its first option).
  const entries = useMemo(
    () =>
      active.flatMap((addon) =>
        (addon.manifest.catalogs ?? [])
          .filter((c) => requiredExtraNames(c).every((n) => n === "genre") && !isDebridLibraryCatalog(c) && !hideAdult.catalog(c))
          .map((catalog) => ({ addon, catalog })),
      ),
    [active],
  );
  const types = useMemo(() => {
    const unique = [...new Set(entries.map((e) => e.catalog.type))];
    return unique.sort((a, b) => (TYPE_ORDER.indexOf(a) + 1 || 99) - (TYPE_ORDER.indexOf(b) + 1 || 99));
  }, [entries]);

  const type = types.includes(params.get("type") ?? "") ? params.get("type")! : types[0];
  const ofType = entries.filter((e) => e.catalog.type === type);
  const selected =
    ofType.find((e) => String(e.addon.id) === params.get("addon") && e.catalog.id === params.get("catalog")) ??
    ofType[0];
  const genres = selected ? genreOptions(selected.catalog) : [];
  const genreRequired = selected ? requiredExtraNames(selected.catalog).includes("genre") : false;
  const genreParam = params.get("genre") ?? "";
  const genre = genres.includes(genreParam) ? genreParam : genreRequired ? (genres[0] ?? "") : "";
  const canPage = selected ? catalogExtraNames(selected.catalog).includes("skip") : false;

  const [items, setItems] = useState<MetaPreview[]>([]);
  const [status, setStatus] = useState<"idle" | "loading" | "more" | "error">("idle");
  const [hasMore, setHasMore] = useState(false);
  const requestId = useRef(0);

  async function load(skip: number) {
    if (!selected) return;
    const id = ++requestId.current;
    setStatus(skip ? "more" : "loading");
    const extra: Extra = {};
    if (genre) extra.genre = genre;
    if (skip) extra.skip = String(skip);
    try {
      const page = await getCatalog(selected.addon, selected.catalog.type, selected.catalog.id, extra);
      if (id !== requestId.current) return; // filters changed meanwhile
      setItems((prev) => {
        if (!skip) return page;
        const seen = new Set(prev.map((m) => m.id));
        return [...prev, ...page.filter((m) => !seen.has(m.id))];
      });
      setHasMore(canPage && page.length > 0);
      setStatus("idle");
    } catch {
      if (id === requestId.current) setStatus("error");
    }
  }

  const selectionKey = selected ? `${selected.addon.id}|${selected.catalog.type}|${selected.catalog.id}|${genre}` : "";
  useEffect(() => {
    setItems([]);
    setHasMore(false);
    load(0);
    // load() reads the current selection; re-run only when it changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionKey]);

  function setFilter(next: Record<string, string>) {
    const merged = { type, addon: String(selected?.addon.id ?? ""), catalog: selected?.catalog.id ?? "", genre, ...next };
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)), { replace: true });
  }

  if (addonsLoading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!selected) return <SuggestedAddons />;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("Descubrir")}</h1>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-type">{t("Tipo")}</Label>
          <NativeSelect id="f-type" value={type} onChange={(e) => setFilter({ type: e.target.value, addon: "", catalog: "", genre: "" })}>
            {types.map((item) => (
              <option key={item} value={item}>
                {typeLabel(item)}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-catalog">{t("Catálogo")}</Label>
          <NativeSelect
            id="f-catalog"
            value={`${selected.addon.id}|${selected.catalog.id}`}
            onChange={(e) => {
              const [addon, ...rest] = e.target.value.split("|");
              setFilter({ addon, catalog: rest.join("|"), genre: "" });
            }}
          >
            {ofType.map(({ addon, catalog }) => (
              <option key={`${addon.id}|${catalog.id}`} value={`${addon.id}|${catalog.id}`}>
                {catalog.name ?? catalog.id} — {addon.manifest.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="f-genre">{t("Género")}</Label>
          <NativeSelect id="f-genre" value={genre} disabled={!genres.length} onChange={(e) => setFilter({ genre: e.target.value })}>
            {!genreRequired && <option value="">{t("Todos")}</option>}
            {genres.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {status === "loading" ? (
        <PosterGridSkeleton />
      ) : status === "error" && items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-sm text-muted-foreground">
          {t("No se pudo cargar el catálogo.")}
          <Button variant="outline" size="sm" onClick={() => load(0)}>
            <RotateCw />
            {t("Reintentar")}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">{t("No hay nada aquí con estos filtros.")}</p>
      ) : (
        <>
          <PosterGrid items={items} />
          {(hasMore || status === "error") && (
            <div className="flex justify-center">
              <Button variant="outline" size="lg" onClick={() => load(items.length)} disabled={status === "more"}>
                {status === "more" ? <Loader2 className="animate-spin" /> : status === "error" ? <RotateCw /> : null}
                {status === "error" ? t("Reintentar") : t("Cargar más")}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
