import { Download as DownloadIcon, Film, Loader2, Play, Settings, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getErrorDetail } from "@/api/client";
import { downloadContext, getDebridAccount, getDownloads, playableLink, removeDownload, type DebridAccount, type Download } from "@/api/debrid";
import { getVideoProgress, resumePoint } from "@/api/progress";
import { DownloadStatus } from "@/components/debrid/DownloadStatus";
import { Button, buttonVariants } from "@/components/ui/button";
import { useProfiles } from "@/context/ProfileContext";
import { episodeCode } from "@/lib/episodes";
import { isDubbedFor, isMultiAudio } from "@/lib/streams";
import type { StreamLang } from "@/lib/languages";
import { detailPath, playerPath } from "@/lib/routes";
import type { PlayerState } from "./Streams";
import { t } from "@/i18n";

const POLL_MS = 5000;

/** What this profile asked its debrid to download, with live progress. */
export default function Downloads() {
  const navigate = useNavigate();
  const { current } = useProfiles();
  const [account, setAccount] = useState<DebridAccount | null>(null);
  const [items, setItems] = useState<Download[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  useEffect(() => {
    getDebridAccount()
      .then(setAccount)
      .catch(() => setAccount({ connected: false }));
  }, []);

  const active = items?.some((d) => !d.ready && !d.failed) ?? true;
  useEffect(() => {
    if (!account?.connected) return;
    let cancelled = false;
    let timer = 0;
    const load = async () => {
      try {
        const list = await getDownloads();
        if (cancelled) return;
        setItems(list);
        setError(null);
        if (list.some((d) => !d.ready && !d.failed)) timer = window.setTimeout(load, POLL_MS);
      } catch (e) {
        if (cancelled) return;
        setItems((prev) => prev ?? []);
        setError(getErrorDetail(e) ?? t("Algo salió mal"));
        timer = window.setTimeout(load, POLL_MS * 2);
      }
    };
    void load();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Re-arm polling when a new active download shows up after it stopped.
  }, [account?.connected, active]);

  async function play(d: Download) {
    setOpening(d.id);
    try {
      const { url } = await playableLink(d.id);
      const saved = await getVideoProgress(d.video_id).catch(() => null);
      const startAt = resumePoint(saved);
      const languages = (d.source.languages ?? []) as StreamLang[];
      const language = current?.language ?? "es-419";
      const state: PlayerState = {
        stream: {
          url,
          name: d.source.name,
          title: d.source.title,
          description: d.source.description,
          behaviorHints: d.source.behaviorHints,
        },
        title: d.episode_title ? `${d.name} · ${d.episode_title}` : d.name,
        progress: downloadContext(d),
        startAt: startAt || undefined,
        resumed: startAt > 0,
        dubbed: isDubbedFor(languages, language) && !isMultiAudio(languages),
        languages,
        alternatives: [],
      };
      navigate(playerPath(d.type, d.video_id), { state });
    } catch (e) {
      setError(getErrorDetail(e) ?? t("Algo salió mal"));
    } finally {
      setOpening(null);
    }
  }

  async function remove(d: Download) {
    setItems((prev) => prev?.filter((x) => x.id !== d.id) ?? null);
    await removeDownload(d.id, !d.ready).catch(() => {});
  }

  if (!account || (account.connected && !items)) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("Descargas")}</h1>
      {!account.connected ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <DownloadIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">{t("Conecta tu Real-Debrid para seguir tus descargas")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("Al elegir una fuente que no está lista, la app le pide la descarga a tu debrid y aquí ves cómo va.")}
          </p>
          <Link to="/settings#debrid" className={buttonVariants({ variant: "outline" })}>
            <Settings />
            {t("Ir a Ajustes")}
          </Link>
        </div>
      ) : items!.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <DownloadIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">{t("No tienes descargas")}</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {t("Cuando elijas una fuente marcada \"No en caché\" y la mandes a descargar, aparecerá aquí con su avance.")}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2" data-remote-start>
          {items!.map((d) => (
            <li key={d.id} className="flex gap-3 rounded-xl border border-border bg-card p-3">
              <Link to={detailPath(d.type, d.meta_id)} className="relative h-24 w-16 shrink-0 overflow-hidden rounded bg-muted" tabIndex={-1}>
                {d.poster ? (
                  <img src={d.poster} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <Film className="m-auto mt-9 size-5 text-muted-foreground" />
                )}
              </Link>
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{d.name}</p>
                  {d.season != null && d.episode != null && (
                    <p className="truncate text-sm text-muted-foreground">
                      {episodeCode(d.season, d.episode)}
                      {d.episode_title ? ` · ${d.episode_title}` : ""}
                    </p>
                  )}
                  <p className="truncate text-xs text-muted-foreground" title={d.filename ?? undefined}>
                    {[d.source.quality, d.source.size, d.filename ?? d.source.headline].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <DownloadStatus status={d} />
                <div className="flex flex-wrap gap-2">
                  {d.ready && (
                    <Button size="sm" onClick={() => void play(d)} disabled={opening === d.id}>
                      {opening === d.id ? <Loader2 className="animate-spin" /> : <Play />}
                      {t("Reproducir")}
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className={d.ready ? undefined : "text-destructive"} onClick={() => void remove(d)}>
                    <Trash2 />
                    {d.ready || d.failed ? t("Quitar de la lista") : t("Cancelar descarga")}
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {account.connected && (
        <p className="text-xs text-muted-foreground">
          {t("Las descargas terminadas se quedan en tu Real-Debrid aunque las quites de esta lista.")}
        </p>
      )}
    </div>
  );
}
