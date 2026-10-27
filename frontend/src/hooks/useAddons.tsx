import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, getErrorDetail } from "@/api/client";
import type { AddonPreview, InstalledAddon } from "@/api/types";
import { fetchManifest, normalizeManifestUrl, type AddonRef, type Manifest } from "@/lib/stremio";
import { t } from "@/i18n";

/** Try to get the manifest from the browser. Undefined means "let the
 * backend download it" (the backend then reports a proper error if that
 * fails too). */
async function manifestFromBrowser(url: string): Promise<Manifest | undefined> {
  const normalized = normalizeManifestUrl(url);
  if (!normalized) return undefined;
  try {
    return await fetchManifest(normalized);
  } catch {
    return undefined;
  }
}

function useAddonsState() {
  const [addons, setAddons] = useState<InstalledAddon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const { data } = await api.get<InstalledAddon[]>("/addons");
      setAddons(data);
      setError(null);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudieron cargar los addons"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  async function preview(url: string) {
    const manifest = await manifestFromBrowser(url);
    const { data } = await api.post<AddonPreview>("/addons/preview", { url, manifest });
    return data;
  }

  /** Pass the manifest from `preview` to avoid downloading it again. */
  async function install(url: string, manifest?: Manifest) {
    const { data } = await api.post<InstalledAddon>("/addons", {
      url,
      manifest: manifest ?? (await manifestFromBrowser(url)),
    });
    setAddons((prev) => [...prev, data]);
    return data;
  }

  async function setEnabled(id: number, enabled: boolean) {
    setAddons((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
    try {
      await api.patch(`/addons/${id}`, { enabled });
    } catch (err) {
      await reload();
      throw err;
    }
  }

  async function move(id: number, direction: -1 | 1) {
    const index = addons.findIndex((a) => a.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= addons.length) return;
    const next = [...addons];
    [next[index], next[target]] = [next[target], next[index]];
    setAddons(next);
    try {
      await api.put("/addons/order", { ids: next.map((a) => a.id) });
    } catch (err) {
      await reload();
      throw err;
    }
  }

  async function refresh(id: number) {
    const addon = addons.find((a) => a.id === id);
    const manifest = addon ? await manifestFromBrowser(addon.transport_url) : undefined;
    const { data } = await api.post<InstalledAddon>(`/addons/${id}/refresh`, { manifest });
    setAddons((prev) => prev.map((a) => (a.id === id ? data : a)));
  }

  async function uninstall(id: number) {
    await api.delete(`/addons/${id}`);
    setAddons((prev) => prev.filter((a) => a.id !== id));
  }

  // Enabled addons in priority order, in the shape lib/stremio expects
  // (plus the installed addon id, used in URLs like /discover?addon=).
  const active: ActiveAddon[] = useMemo(
    () =>
      addons
        .filter((a) => a.enabled)
        .map((a) => ({ id: a.id, transportUrl: a.transport_url, manifest: a.manifest })),
    [addons],
  );

  return { addons, active, loading, error, reload, preview, install, setEnabled, move, refresh, uninstall };
}

export type ActiveAddon = AddonRef & { id: number };

type AddonsValue = ReturnType<typeof useAddonsState>;

const AddonsContext = createContext<AddonsValue | undefined>(undefined);

/** Installed addons of the current profile. Mount with `key={profile.id}` so
 * switching profiles starts from a clean list. */
export function AddonsProvider({ children }: { children: ReactNode }) {
  return <AddonsContext.Provider value={useAddonsState()}>{children}</AddonsContext.Provider>;
}

export function useAddons(): AddonsValue {
  const ctx = useContext(AddonsContext);
  if (!ctx) throw new Error("useAddons debe usarse dentro de un AddonsProvider");
  return ctx;
}
