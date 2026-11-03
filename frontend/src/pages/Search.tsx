import { useCallback, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CatalogRow } from "@/components/catalog/CatalogRow";
import { SuggestedAddons } from "@/components/catalog/SuggestedAddons";
import { SearchSuggest } from "@/components/catalog/SearchSuggest";
import { useAddons } from "@/hooks/useAddons";
import { typeLabel } from "@/lib/labels";
import { searchCatalogs } from "@/lib/stremio";
import { t } from "@/i18n";

/** Searches every catalog that supports `search`, one row per catalog. */
export default function Search() {
  const { active, loading } = useAddons();
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const [draft, setDraft] = useState(query);
  const catalogs = searchCatalogs(active);


  return (
    <div className="flex flex-col gap-6">
      <SearchSuggest
        value={draft}
        onChange={setDraft}
        onSubmit={(q) => setParams(q ? { q } : {}, { replace: false })}
        placeholder={t("Buscar películas, series...")}
        inputClassName="h-12 pl-10 text-base"
        iconClassName="left-3 size-5"
        autoFocus={!query}
      />

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
          // In results the catalog's own name ("Popular") is noise: the type
          // is enough, with the addon name below.
          title={typeLabel(catalog.type)}
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
