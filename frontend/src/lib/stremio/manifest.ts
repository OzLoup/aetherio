import type { CatalogDescriptor, Manifest, ResourceName } from "./types";

export function resourceNames(manifest: Manifest): ResourceName[] {
  return manifest.resources.map((r) => (typeof r === "string" ? r : r.name));
}

/** Addon base URL — what /catalog, /meta, /stream paths hang off. */
export function addonBaseUrl(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json$/, "");
}

/** Page where a configurable addon lets the user generate a new URL. */
export function configureUrl(transportUrl: string): string {
  return `${addonBaseUrl(transportUrl)}/configure`;
}

const DEBRID_LIBRARY = /real-?debrid|all-?debrid|premiumize|debrid-?link|torbox|offcloud|put\.?io|easy-?debrid/i;

/** A "your debrid downloads" catalog (Torrentio/Comet add one per debrid
 * account): a list of file names without posters, not something to browse.
 * Hidden from Home, Discover and search. */
export function isDebridLibraryCatalog(catalog: CatalogDescriptor) {
  return DEBRID_LIBRARY.test(catalog.id) || DEBRID_LIBRARY.test(catalog.name ?? "");
}

/** Catalogs that show up on their own (no required extra like `search`). */
export function browsableCatalogs(manifest: Manifest) {
  return (manifest.catalogs ?? []).filter(
    (c) => !(c.extra ?? []).some((e) => e.isRequired) && !(c.extraRequired ?? []).length && !isDebridLibraryCatalog(c),
  );
}
