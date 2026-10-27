/**
 * +18 content, per profile. Same explicit signals the backend uses
 * (backend/app/adult.py): a manifest flagged `adult`, or words like
 * xxx/porn/+18 in names. Profiles without adult content get those addons
 * refused, and here mixed sources are trimmed: adult catalogs, genres,
 * titles and IPTV groups are hidden.
 */
import type { CatalogDescriptor, Manifest, MetaPreview } from "./types";

const ADULT_WORDS =
  /(\bxxx\b|porn|\bnsfw\b|\b18\s*\+|\+\s*18\b|\badult(s|os|o|e|es)?\b|\bpara adultos\b|\berotic|\ber[oó]tic|\bhentai\b|\bsexy?\b|\bonlyfans\b)/i;
// For titles/genres of catalog items: stricter (no "adult", which also
// names ordinary things like "Adult Swim" or "young adult").
const ADULT_ITEM = /(\bxxx\b|porn|\bhentai\b|\ber[oó]tic|\bonlyfans\b)/i;

let adultAllowed = false;

/** Set from the current profile (App.tsx). */
export function setAdultAllowed(allowed: boolean) {
  adultAllowed = allowed;
}

export function isAdultAllowed() {
  return adultAllowed;
}

export function isAdultText(...texts: (string | undefined | null)[]) {
  return texts.some((t) => t && ADULT_WORDS.test(t));
}

export function isAdultManifest(m: Manifest) {
  if ((m.behaviorHints as { adult?: boolean } | undefined)?.adult) return true;
  return isAdultText(m.name, m.description, m.id, ...(m.catalogs ?? []).flatMap((c) => [c.name, c.id]));
}

export function isAdultCatalog(c: CatalogDescriptor) {
  return isAdultText(c.name, c.id);
}

export function isAdultMeta(m: MetaPreview) {
  const genres = [...(m.genres ?? []), ...(m.genre ?? [])];
  return ADULT_ITEM.test(m.name) || genres.some((g) => ADULT_WORDS.test(g));
}

/** Hide this (catalog, genre, item, IPTV group) for the current profile? */
export const hideAdult = {
  catalog: (c: CatalogDescriptor) => !adultAllowed && isAdultCatalog(c),
  genre: (g: string) => !adultAllowed && ADULT_WORDS.test(g),
  meta: (m: MetaPreview) => !adultAllowed && isAdultMeta(m),
  group: (g: string) => !adultAllowed && ADULT_WORDS.test(g),
};
