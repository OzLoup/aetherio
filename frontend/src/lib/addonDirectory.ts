import { isAdultManifest, resourceNames, type Manifest } from "@/lib/stremio";

/** Public lists of community addons (same format: { transportUrl, manifest }).
 * Both allow being read from the browser. */
const DIRECTORIES = [
  "https://api.strem.io/addonscollection.json", // Stremio's own collection
  "https://stremio-addons.net/api/addon_catalog/all/stremio-addons.net.json",
];

export interface DirectoryAddon {
  transportUrl: string;
  manifest: Manifest;
}

/** What the person is looking for. */
export type AddonKind = "" | "catalog" | "stream" | "subtitles";

let cached: Promise<DirectoryAddon[]> | null = null;

function normalize(url: string) {
  return url.trim().replace(/^stremio:\/\//, "https://").replace(/\/+$/, "").toLowerCase();
}

/** Both directories merged, without repeats (same URL or same addon id). */
export function mergeDirectories(lists: unknown[][]): DirectoryAddon[] {
  const byUrl = new Set<string>();
  const byId = new Set<string>();
  const out: DirectoryAddon[] = [];
  for (const list of lists) {
    for (const raw of list) {
      const a = raw as Partial<DirectoryAddon>;
      const m = a?.manifest;
      if (!a?.transportUrl || !m?.id || !m.name || !/^https?:|^stremio:/.test(a.transportUrl)) continue;
      const url = normalize(a.transportUrl);
      if (byUrl.has(url) || byId.has(m.id)) continue;
      byUrl.add(url);
      byId.add(m.id);
      out.push({ transportUrl: a.transportUrl.replace(/^stremio:\/\//, "https://"), manifest: m as Manifest });
    }
  }
  return out;
}

/** Downloaded once per session; a directory that fails is just skipped. */
export function loadDirectory(): Promise<DirectoryAddon[]> {
  cached ??= Promise.all(
    DIRECTORIES.map(async (url) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data) ? data : Array.isArray(data?.addons) ? data.addons : [];
      } catch {
        return [];
      }
    }),
  ).then((lists) => {
    const merged = mergeDirectories(lists);
    if (!merged.length) cached = null; // try again next time
    return merged;
  });
  return cached;
}

function fold(text: string) {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Filter by words (name first, then description) and by what it provides.
 * Adult addons only when the profile allows them. */
export function searchDirectory(list: DirectoryAddon[], query: string, kind: AddonKind, allowAdult: boolean) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  const scored: { a: DirectoryAddon; score: number }[] = [];
  for (const a of list) {
    const m = a.manifest;
    if (!allowAdult && isAdultManifest(m)) continue;
    if (kind && !resourceNames(m).includes(kind)) continue;
    const name = fold(m.name);
    const text = `${name} ${fold(m.description ?? "")}`;
    if (!words.every((w) => text.includes(w))) continue;
    const score = words.length === 0 ? 0 : words.every((w) => name.includes(w)) ? 0 : 1;
    scored.push({ a, score });
  }
  return scored.sort((x, y) => x.score - y.score).map((x) => x.a);
}
