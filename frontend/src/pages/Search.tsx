import { Search as SearchIcon } from "lucide-react";
import { useCallback, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { CatalogRow } from "@/components/catalog/CatalogRow";
import { SuggestedAddons } from "@/components/catalog/SuggestedAddons";
import { Input } from "@/components/ui/input";
import { useAddons } from "@/hooks/useAddons";
import { catalogTitle } from "@/lib/labels";
import { searchCatalogs } from "@/lib/stremio";
import { t } from "@/i18n";

/** Searches every catalog that supports `search`, one row per catalog. */
export default function Search() {
  const { active, loading } = useAddons();
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const [draft, setDraft] = useState(query);
  const catalogs = searchCatalogs(active);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const q = draft.trim();
    setParams(q ? { q } : {}, { replace: false });
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="relative">
        <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("Buscar películas, series...")}
          className="h-12 pl-10 text-base"
          autoFocus={!query}
          aria-label={t("Buscar")}
        />
      </form>

      {!loading && active.length === 0 ? (
        <SuggestedAddons />
      ) : !loading && catalogs.length === 0 ? (
        <p className="py-12 text-center text-sm text-muted-foreground">
          {t("Ninguno de tus addons permite buscar. Instala uno con búsqueda, como Cinemeta.")}
        </p>
      ) : query ? (
        // key resets the "everything empty" tracking for each new query
        <SearchResults key={query} query={query} catalogs={catalogs} />
      ) : (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("Escribe lo que quieres ver.")}</p>
      )}
    </div>
  );
}

function SearchResults({ query, catalogs }: { query: string; catalogs: ReturnType<typeof searchCatalogs> }) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const report = useCallback((key: string, n: number) => setCounts((c) => ({ ...c, [key]: n })), []);
  const keys = catalogs.map(({ addon, catalog }) => `${addon.transportUrl}|${catalog.type}|${catalog.id}`);
  const allEmpty = keys.every((k) => counts[k] === 0);

  return (
    <div className="flex flex-col gap-8">
      {allEmpty && (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("No encontramos nada para “{query}”.", { query })}</p>
      )}
      {catalogs.map(({ addon, catalog }, i) => (
        <CatalogRow
          key={keys[i]}
          title={catalogTitle(catalog.name, catalog.id, catalog.type)}
          subtitle={addon.manifest.name}
          addon={addon}
          type={catalog.type}
          catalogId={catalog.id}
          extra={{ search: query }}
          hideWhenEmpty
          onLoaded={(n) => report(keys[i], n)}
        />
      ))}
    </div>
  );
}
