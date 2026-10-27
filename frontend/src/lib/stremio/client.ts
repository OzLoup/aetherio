import { addonBaseUrl, isDebridLibraryCatalog } from "./manifest";
import type { AddonRef, CatalogDescriptor, Extra, Manifest, MetaDetail, MetaPreview, ResourceName, Stream, Subtitle } from "./types";
import { t } from "@/i18n";

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15000;

/** `/{resource}/{type}/{id}[/{extra}].json`, the addon protocol's URL shape. */
export function resourceUrl(transportUrl: string, resource: ResourceName, type: string, id: string, extra?: Extra) {
  const extraPart = extra && Object.keys(extra).length
    ? "/" +
      Object.entries(extra)
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&")
    : "";
  return `${addonBaseUrl(transportUrl)}/${resource}/${encodeURIComponent(type)}/${encodeURIComponent(id)}${extraPart}.json`;
}

/** Does this addon answer `resource` for this type (and id, if given)?
 * Mirrors Stremio: a resource descriptor can narrow types/idPrefixes;
 * otherwise the manifest-level ones apply. */
export function supportsResource(manifest: Manifest, resource: ResourceName, type: string, id?: string) {
  const entry = manifest.resources.find((r) => (typeof r === "string" ? r : r.name) === resource);
  if (!entry) return false;
  const types = typeof entry === "string" ? manifest.types : (entry.types ?? manifest.types);
  if (types && !types.includes(type)) return false;
  const prefixes = typeof entry === "string" ? manifest.idPrefixes : (entry.idPrefixes ?? manifest.idPrefixes);
  if (id && prefixes && prefixes.length && !prefixes.some((p) => id.startsWith(p))) return false;
  return true;
}

export function catalogExtraNames(catalog: CatalogDescriptor): string[] {
  return [...(catalog.extra ?? []).map((e) => e.name), ...(catalog.extraSupported ?? [])];
}

export function requiredExtraNames(catalog: CatalogDescriptor): string[] {
  return [...(catalog.extra ?? []).filter((e) => e.isRequired).map((e) => e.name), ...(catalog.extraRequired ?? [])];
}

export function genreOptions(catalog: CatalogDescriptor): string[] {
  return (catalog.extra ?? []).find((e) => e.name === "genre")?.options ?? [];
}

// Small in-memory cache: navigating back to Home shouldn't refetch every row.
// Stores promises, so concurrent requests for the same URL share one fetch.
const cache = new Map<string, { expires: number; promise: Promise<unknown> }>();

export function fetchResource<T>(url: string, { ttlMs = DEFAULT_TTL_MS, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const hit = cache.get(url);
  if (hit && hit.expires > Date.now()) return hit.promise as Promise<T>;

  const promise = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.set(url, { expires: Date.now() + ttlMs, promise });
  promise.catch(() => cache.delete(url));
  return promise;
}

export async function getCatalog(addon: AddonRef, type: string, catalogId: string, extra?: Extra) {
  const data = await fetchResource<{ metas?: MetaPreview[] }>(
    resourceUrl(addon.transportUrl, "catalog", type, catalogId, extra),
  );
  return (data.metas ?? []).filter((m) => m && m.id && m.name);
}

/** Ask addons in priority order and return the first full meta found. */
export async function getMeta(addons: AddonRef[], type: string, id: string) {
  for (const addon of addons) {
    if (!supportsResource(addon.manifest, "meta", type, id)) continue;
    try {
      const data = await fetchResource<{ meta?: MetaDetail }>(resourceUrl(addon.transportUrl, "meta", type, id));
      if (data.meta && data.meta.name) return { meta: data.meta, addon };
    } catch {
      // try the next addon
    }
  }
  return null;
}

/** Every catalog that accepts a `search` extra, across addons. */
export function searchCatalogs(addons: AddonRef[]) {
  return addons.flatMap((addon) =>
    (addon.manifest.catalogs ?? [])
      .filter((c) => catalogExtraNames(c).includes("search") && !isDebridLibraryCatalog(c))
      .map((catalog) => ({ addon, catalog })),
  );
}

export interface AddonResult<T> {
  addon: AddonRef;
  items: T[];
  error?: string;
}

/** Ask every addon that serves `resource` for this item, in parallel. One
 * slow or broken addon doesn't block the rest: `onResult` fires per addon. */
async function fromAllAddons<T>(
  addons: AddonRef[],
  resource: "stream" | "subtitles",
  type: string,
  id: string,
  pick: (data: Record<string, unknown>) => T[] | undefined,
  { extra, onResult, timeoutMs = 25000 }: { extra?: Extra; onResult?: (r: AddonResult<T>) => void; timeoutMs?: number } = {},
) {
  const targets = addons.filter((a) => supportsResource(a.manifest, resource, type, id));
  return Promise.all(
    targets.map(async (addon): Promise<AddonResult<T>> => {
      let result: AddonResult<T>;
      try {
        // Streams change (debrid cache, new releases): cache them briefly.
        const data = await fetchResource<Record<string, unknown>>(resourceUrl(addon.transportUrl, resource, type, id, extra), {
          ttlMs: 2 * 60 * 1000,
          timeoutMs,
        });
        result = { addon, items: pick(data) ?? [] };
      } catch (err) {
        result = { addon, items: [], error: err instanceof Error && err.name === "AbortError" ? t("tardó demasiado") : t("no respondió") };
      }
      onResult?.(result);
      return result;
    }),
  );
}

export function addonsFor(addons: AddonRef[], resource: ResourceName, type: string, id: string) {
  return addons.filter((a) => supportsResource(a.manifest, resource, type, id));
}

export function getStreams(addons: AddonRef[], type: string, id: string, onResult?: (r: AddonResult<Stream>) => void) {
  return fromAllAddons<Stream>(addons, "stream", type, id, (d) => d.streams as Stream[] | undefined, { onResult });
}

export async function getSubtitles(addons: AddonRef[], type: string, id: string, extra?: Extra) {
  const results = await fromAllAddons<Subtitle>(addons, "subtitles", type, id, (d) => d.subtitles as Subtitle[] | undefined, {
    extra,
    timeoutMs: 12000,
  });
  return results.flatMap((r) => r.items.filter((s) => s && s.url && s.lang));
}
