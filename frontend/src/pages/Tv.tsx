import { Loader2, Plus, Radio, Search, Smartphone, Trash2, Tv as TvIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { getErrorDetail } from "@/api/client";
import { addPlaylist, listPlaylists, loadChannels, PLAYLIST_PRESETS, removePlaylist } from "@/api/playlists";
import type { Playlist } from "@/api/types";
import { CatalogRow } from "@/components/catalog/CatalogRow";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAddons } from "@/hooks/useAddons";
import { android } from "@/lib/android";
import { desktop } from "@/lib/desktop";
import { countryFlag, countryName, groupLabel, type Channel } from "@/lib/m3u";
import { NativeSelect } from "@/components/ui/native-select";
import { catalogTitle } from "@/lib/labels";
import { discoverHref, playerPath } from "@/lib/routes";
import { browsableCatalogs } from "@/lib/stremio";
import { cn } from "@/lib/utils";
import type { PlayerState } from "./Streams";
import { locale, t } from "@/i18n";

/** Live TV addon a profile can add in one click (static, hosted on GitHub). */
export const USA_TV_NEXT = "https://raw.githubusercontent.com/yowmamasita/usa-tv-next/main/manifest.json";
const PAGE = 60;
const LIST_KEY = "ap_tv_list";
const COUNTRY_KEY = "ap_tv_country";
// Pseudo-category: every Pluto TV channel, wherever it says it's from.
const PLUTO = "__pluto";

function remembered(key: string) {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

/** The browser can't open plain-http links from an https site, nor raw
 * MPEG-TS: those channels only play in the apps (Android, Mac). */
function webCantPlay(c: Channel) {
  if (android || desktop) return false;
  return (location.protocol === "https:" && c.url.startsWith("http:")) || /\.ts(\?|$)/i.test(c.url);
}

export default function Tv() {
  const navigate = useNavigate();
  const { active, addons, install } = useAddons();
  const [playlists, setPlaylists] = useState<Playlist[] | null>(null);
  const [listId, setListId] = useState<number | null>(() => Number(localStorage.getItem(LIST_KEY)) || null);
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("");
  // Per device, like the chosen list.
  const [country, setCountryState] = useState(() => remembered(COUNTRY_KEY));
  function setCountry(c: string) {
    setCountryState(c);
    setLimit(PAGE);
    try {
      localStorage.setItem(COUNTRY_KEY, c);
    } catch {
      // per-device convenience only
    }
  }
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const tvRows = active.flatMap((addon) =>
    browsableCatalogs(addon.manifest)
      .filter((c) => c.type === "tv")
      .map((catalog) => ({ addon, catalog })),
  );
  const hasUsaTv = addons.some((a) => a.transport_url === USA_TV_NEXT);

  useEffect(() => {
    listPlaylists()
      .then(setPlaylists)
      .catch(() => setPlaylists([]));
  }, []);

  const playlist = playlists?.find((p) => p.id === listId) ?? playlists?.[0] ?? null;

  useEffect(() => {
    if (!playlist) return;
    let cancelled = false;
    setChannels(null);
    setLoadError(null);
    setGroup("");
    setLimit(PAGE);
    try {
      localStorage.setItem(LIST_KEY, String(playlist.id));
    } catch {
      // per-device convenience only
    }
    loadChannels(playlist)
      .then((list) => !cancelled && setChannels(list))
      .catch((err) => !cancelled && setLoadError(getErrorDetail(err) ?? t("No se pudo cargar la lista")));
    return () => {
      cancelled = true;
    };
  }, [playlist]);

  const groups = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of channels ?? []) for (const g of c.groups) count.set(g, (count.get(g) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([g]) => g);
  }, [channels]);

  // Countries in this list, most channels first.
  const countries = useMemo(() => {
    const count = new Map<string, number>();
    for (const c of channels ?? []) if (c.country) count.set(c.country, (count.get(c.country) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [channels]);
  const hasPluto = useMemo(() => (channels ?? []).some((c) => c.pluto), [channels]);
  // A remembered country this list doesn't have: show everything.
  const activeCountry = countries.some(([c]) => c === country) ? country : "";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (channels ?? []).filter(
      (c) =>
        (!activeCountry || c.country === activeCountry) &&
        (!group || (group === PLUTO ? c.pluto : c.groups.includes(group))) &&
        (!q || c.name.toLowerCase().includes(q)),
    );
  }, [channels, query, group, activeCountry]);

  function play(c: Channel) {
    if (webCantPlay(c)) {
      setNotice(t("{name} solo se puede ver en la app de Android o de Mac: el navegador bloquea este tipo de enlace.", { name: c.name }));
      return;
    }
    const state: PlayerState = {
      stream: {
        url: c.url,
        name: c.name,
        behaviorHints: c.headers ? { proxyHeaders: { request: c.headers }, notWebReady: true } : undefined,
      },
      title: c.name,
      // Live TV: no subtitles by default, nothing to resume.
      dubbed: true,
      languages: [],
      alternatives: [],
    };
    navigate(playerPath("tv", `iptv:${c.id}`), { state });
  }

  async function installUsaTv() {
    setInstalling(true);
    try {
      await install(USA_TV_NEXT);
    } catch (err) {
      setNotice(getErrorDetail(err) ?? t("No se pudo instalar el addon"));
    } finally {
      setInstalling(false);
    }
  }

  async function deleteList(p: Playlist) {
    await removePlaylist(p.id);
    setPlaylists((prev) => (prev ?? []).filter((x) => x.id !== p.id));
    if (listId === p.id) setListId(null);
  }

  const empty = playlists !== null && playlists.length === 0 && tvRows.length === 0;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Radio className="size-6 text-primary" />
          {t("TV en vivo")}
        </h1>
        <div className="flex flex-wrap gap-2">
          {!hasUsaTv && (
            <Button variant="outline" onClick={installUsaTv} disabled={installing}>
              {installing ? <Loader2 className="animate-spin" /> : <TvIcon />}
              {t("Agregar USA TV Next")}
            </Button>
          )}
          <Button onClick={() => setAdding(true)}>
            <Plus />
            {t("Agregar lista")}
          </Button>
        </div>
      </div>

      {notice && (
        <p className="flex items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm">
          <span>{notice}</span>
          <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
            {t("Cerrar")}
          </Button>
        </p>
      )}

      {empty && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-12 text-center">
          <TvIcon className="size-10 text-muted-foreground" />
          <p className="font-semibold">{t("Todavía no tienes canales")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("Agrega una lista de canales (hay listas públicas y gratuitas en español, con Pluto TV y novelas) o un addon de TV en vivo.")}
          </p>
          <Button onClick={() => setAdding(true)} autoFocus>
            <Plus />
            {t("Agregar lista")}
          </Button>
        </div>
      )}

      {/* Live TV catalogs of installed addons (USA TV Next, etc.). */}
      {tvRows.map(({ addon, catalog }) => (
        <CatalogRow
          key={`${addon.id}|${catalog.id}`}
          title={catalogTitle(catalog.name, catalog.id, catalog.type)}
          subtitle={addon.manifest.name}
          addon={addon}
          type={catalog.type}
          catalogId={catalog.id}
          seeAllHref={discoverHref(addon.id, catalog.type, catalog.id)}
        />
      ))}

      {/* IPTV lists. */}
      {playlists && playlists.length > 0 && (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {playlists.map((p) => (
              <div key={p.id} className="flex items-center">
                <Button
                  variant={playlist?.id === p.id ? "default" : "outline"}
                  size="sm"
                  className="rounded-r-none"
                  onClick={() => setListId(p.id)}
                >
                  {p.name}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-l-none border-l-0 px-2"
                  onClick={() => deleteList(p)}
                  aria-label={t("Quitar lista {name}", { name: p.name })}
                  title={t("Quitar lista")}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder={t("Buscar canal (ej. novelas, noticias)")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(PAGE);
                }}
                aria-label={t("Buscar canal")}
              />
            </div>
            {countries.length > 1 && (
              <NativeSelect
                value={activeCountry}
                onChange={(e) => setCountry(e.target.value)}
                className="w-56"
                aria-label={t("País")}
              >
                <option value="">{t("Todos los países")}</option>
                {countries.map(([code, n]) => (
                  <option key={code} value={code}>
                    {countryFlag(code)} {countryName(code, locale())} ({n})
                  </option>
                ))}
              </NativeSelect>
            )}
            {channels && (
              <span className="text-sm text-muted-foreground">{t("{n} canales", { n: filtered.length })}</span>
            )}
          </div>

          {groups.length > 1 && (
            <div className="flex flex-wrap gap-1.5">
              {["", ...(hasPluto ? [PLUTO] : []), ...groups.slice(0, 24)].map((g) => (
                <button
                  key={g || "all"}
                  onClick={() => {
                    setGroup(g);
                    setLimit(PAGE);
                  }}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                    group === g ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted",
                  )}
                >
                  {g === PLUTO ? "Pluto TV" : g ? t(groupLabel(g)) : t("Todos")}
                </button>
              ))}
            </div>
          )}

          {loadError && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{loadError}</p>}
          {!channels && !loadError && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              {t("Cargando canales…")}
            </p>
          )}

          {channels && (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {filtered.slice(0, limit).map((c) => (
                <li key={c.id}>
                  <ChannelCard channel={c} onPlay={play} />
                </li>
              ))}
            </ul>
          )}
          {channels && filtered.length > limit && (
            <Button variant="outline" className="self-center" onClick={() => setLimit((n) => n + PAGE)}>
              {t("Cargar más")}
            </Button>
          )}
        </section>
      )}

      <AddPlaylistDialog
        open={adding}
        onOpenChange={setAdding}
        existing={playlists ?? []}
        onAdded={(p) => {
          setPlaylists((prev) => [...(prev ?? []), p]);
          setListId(p.id);
        }}
      />
    </div>
  );
}

function ChannelCard({ channel, onPlay }: { channel: Channel; onPlay: (c: Channel) => void }) {
  const [failed, setFailed] = useState(false);
  const appOnly = webCantPlay(channel);
  return (
    <button
      onClick={() => onPlay(channel)}
      className="group flex w-full flex-col gap-2 rounded-lg text-left focus-visible:outline-none"
      title={channel.name}
    >
      <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-muted p-4 ring-offset-2 ring-offset-background transition group-hover:ring-2 group-hover:ring-primary group-focus-visible:ring-4 group-focus-visible:ring-foreground">
        {channel.logo && !failed ? (
          <img src={channel.logo} alt="" loading="lazy" onError={() => setFailed(true)} className="max-h-full max-w-full object-contain" />
        ) : (
          <TvIcon className="size-8 text-muted-foreground" />
        )}
        {appOnly && (
          <span className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white" title={t("Solo en la app de Android o de Mac")}>
            <Smartphone className="size-3" />
            {t("App")}
          </span>
        )}
      </div>
      <p className={cn("truncate px-0.5 text-sm font-medium", appOnly && "text-muted-foreground")}>{channel.name}</p>
    </button>
  );
}

function AddPlaylistDialog({
  open,
  onOpenChange,
  existing,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing: Playlist[];
  onAdded: (p: Playlist) => void;
}) {
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setUrl("");
      setError(null);
    }
  }, [open]);

  async function add(n: string, u: string) {
    setBusy(true);
    setError(null);
    try {
      onAdded(await addPlaylist(n, u));
      onOpenChange(false);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo agregar la lista"));
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    add(name.trim() || t("Mi lista"), url.trim());
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Agregar lista de canales")}</DialogTitle>
          <DialogDescription>{t("Listas IPTV en formato M3U. Los canales se reproducen directo desde su servidor.")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {PLAYLIST_PRESETS.map((p) => {
            const added = existing.some((e) => e.url === p.url);
            return (
              <button
                key={p.url}
                disabled={added || busy}
                onClick={() => add(t(p.name), p.url)}
                className="flex flex-col gap-0.5 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none disabled:opacity-50"
              >
                <span className="font-medium">
                  {t(p.name)} {added && <span className="text-xs text-muted-foreground">· {t("ya agregada")}</span>}
                </span>
                <span className="text-xs text-muted-foreground">{t(p.description)}</span>
              </button>
            );
          })}
          <p className="text-[11px] text-muted-foreground">{t("Listas públicas de iptv-org: canales gratuitos que sus dueños emiten abiertamente.")}</p>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-4">
          <p className="text-sm font-medium">{t("O pega la URL de tu lista")}</p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pl-name">{t("Nombre")}</Label>
            <Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={t("Mi lista")} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pl-url">{t("URL (.m3u o .m3u8)")}</Label>
            <Input id="pl-url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/lista.m3u" required />
          </div>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={busy || !url.trim()} className="self-end">
            {busy && <Loader2 className="animate-spin" />}
            {t("Agregar")}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
