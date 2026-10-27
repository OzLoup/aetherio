import type { Manifest } from "./types";

/** Same rules as the backend's `normalize_manifest_url`: accepts stremio://
 * links, missing scheme, and URLs without /manifest.json. Returns null if it
 * can't be turned into an http(s) manifest URL. */
export function normalizeManifestUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (url.startsWith("stremio://")) url = "https://" + url.slice("stremio://".length);
  if (!url.includes("://")) url = "https://" + url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (!parsed.pathname.endsWith("/manifest.json")) {
    parsed.pathname = parsed.pathname.replace(/\/+$/, "") + "/manifest.json";
  }
  parsed.hash = "";
  return parsed.toString();
}

/** Download a manifest straight from the addon, the way Stremio Web does.
 * Addons are required to send CORS headers, so this works for most of them;
 * it fails for http addons on an https page and for addons without CORS. */
export async function fetchManifest(manifestUrl: string, timeoutMs = 10000): Promise<Manifest> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(manifestUrl, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: unknown = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("not a manifest");
    return data as Manifest;
  } finally {
    clearTimeout(timer);
  }
}
