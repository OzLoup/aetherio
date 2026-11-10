import { useEffect, useRef, useState } from "react";
import { api, getErrorDetail } from "@/api/client";
import {
  getDebridAccount,
  getDownload,
  playableLink,
  startDownload,
  torrentsStatus,
  type Download,
  type TorrentStatus,
} from "@/api/debrid";
import type { ProgressContext } from "@/api/progress";
import { DownloadStatus } from "@/components/debrid/DownloadStatus";
import { torrentRef, type TorrentRef } from "@/lib/streams";
import type { Stream } from "@/lib/stremio";
import { t } from "@/i18n";

const POLL_MS = 5000;
// No progress and no seeds for this long: it most likely won't finish.
const STALLED_MS = 90_000;

interface Progress {
  supported: boolean;
  found?: boolean;
  status?: string;
  progress?: number;
  speed?: number;
  seeders?: number | null;
}

const WAITING = new Set(["magnet_conversion", "waiting_files_selection", "queued"]);
const FAILED = new Set(["magnet_error", "error", "virus", "dead"]);

function speedLabel(bytesPerSecond: number) {
  const mb = bytesPerSecond / 1_000_000;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1000)} KB/s`;
}

/** Live progress of the debrid download behind a stream the addon said was
 * ready but gave a "downloading" clip for.
 * - Real-Debrid key saved + we know the title: the app asks Real-Debrid for
 *   the torrent itself (reusing it if the addon already added it), follows
 *   it and hands `onDirect` a direct Real-Debrid link when it's done, so it
 *   doesn't depend on the addon (Comet keeps giving its clip for a while).
 * - Key saved only: follows the torrent by its hash; `onReady` when done.
 * - No key: reads Torrentio links as before. */
export function DebridProgress({
  url,
  stream,
  videoId,
  context,
  onReady,
  onDirect,
}: {
  url: string;
  stream?: Stream;
  videoId?: string;
  context?: ProgressContext;
  onReady: () => void;
  onDirect?: (url: string) => void;
}) {
  const [accountMode, setMode] = useState<"hash" | "url" | null>(null);
  const ref = stream ? torrentRef(stream) : null;
  const hash = ref?.infohash;
  const mode = hash ? accountMode : "url";

  useEffect(() => {
    let cancelled = false;
    if (!hash) return;
    getDebridAccount()
      .then((a) => !cancelled && setMode(a.connected && a.valid !== false ? "hash" : "url"))
      .catch(() => !cancelled && setMode("url"));
    return () => {
      cancelled = true;
    };
  }, [hash]);

  if (mode === "hash" && ref && stream && videoId && context && onDirect) {
    return <ByDownload stream={stream} torrent={ref} videoId={videoId} context={context} onDirect={onDirect} />;
  }
  if (mode === "hash" && hash) return <ByHash hash={hash} onReady={onReady} />;
  if (mode === "url") return <ByUrl url={url} onReady={onReady} />;
  return null;
}

/** Asks Real-Debrid for it (Descargas), follows it, then a direct link. */
function ByDownload({
  stream,
  torrent,
  videoId,
  context,
  onDirect,
}: {
  stream: Stream;
  torrent: TorrentRef;
  videoId: string;
  context: ProgressContext;
  onDirect: (url: string) => void;
}) {
  const [download, setDownload] = useState<Download | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onDirectRef = useRef(onDirect);
  useEffect(() => {
    onDirectRef.current = onDirect;
  });

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let id: number | null = null;
    const finish = async (d: Download) => {
      try {
        const { url } = await playableLink(d.id);
        if (!cancelled && url) onDirectRef.current(url);
      } catch (e) {
        if (!cancelled) setError(getErrorDetail(e) ?? t("Algo salió mal"));
      }
    };
    const follow = (d: Download) => {
      if (cancelled) return;
      setDownload(d);
      if (d.ready) return void finish(d);
      if (d.failed) return;
      timer = window.setTimeout(async () => {
        try {
          const next = await getDownload(id!);
          setError(null);
          follow(next);
        } catch {
          if (cancelled) return;
          setError(t("No se pudo consultar a tu debrid. Reintentando…"));
          follow(d);
        }
      }, POLL_MS);
    };
    startDownload(torrent, videoId, context, {
      name: stream.name,
      title: stream.title,
      description: stream.description,
      behaviorHints: stream.behaviorHints,
    })
      .then((d) => {
        id = d.id;
        setError(null);
        follow(d);
      })
      .catch((e) => !cancelled && setError(getErrorDetail(e) ?? t("Algo salió mal")));
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Once per stream (and per "Reintentar").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [torrent.infohash, attempt]);

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-left text-white [&_p]:text-white/80">
      {download ? (
        <DownloadStatus status={download} />
      ) : (
        !error && (
          <p className="text-sm" role="status">
            {t("Pidiendo la descarga a Real-Debrid…")}
          </p>
        )
      )}
      {download?.ready && !error && <p className="text-sm">{t("¡Listo! Empezando…")}</p>}
      {error && <p className="text-sm">{error}</p>}
      {(download?.failed || (error && !download)) && (
        <button
          type="button"
          onClick={() => {
            setDownload(null);
            setError(null);
            setAttempt((n) => n + 1);
          }}
          className="self-start rounded-md border border-white/30 px-3 py-1.5 text-sm hover:bg-white/10"
        >
          {t("Reintentar")}
        </button>
      )}
    </div>
  );
}

/** The torrent as it is in the user's Real-Debrid. */
function ByHash({ hash, onReady }: { hash: string; onReady: () => void }) {
  const [status, setStatus] = useState<TorrentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let done = false;
    const poll = async () => {
      try {
        const { items } = await torrentsStatus([hash]);
        if (cancelled) return;
        const s = items[hash] ?? null;
        setStatus(s);
        setError(null);
        if (s?.ready && !done) {
          done = true;
          onReadyRef.current();
          return;
        }
      } catch {
        if (!cancelled) setError(t("No se pudo consultar a tu debrid. Reintentando…"));
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hash]);

  return (
    <div className="flex w-full max-w-sm flex-col gap-2 text-left text-white [&_p]:text-white/80">
      {status ? (
        <DownloadStatus status={status} />
      ) : (
        <p className="text-sm text-white/80" role="status">
          {error ?? t("Esperando a que tu debrid empiece la descarga…")}
        </p>
      )}
      {status && error && <p className="text-sm text-white/80">{error}</p>}
    </div>
  );
}

/** Legacy: progress read from a Torrentio link (no key saved). */
function ByUrl({ url, onReady }: { url: string; onReady: () => void }) {
  const [data, setData] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  });

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let lastChange = Date.now();
    let lastProgress = -1;
    let done = false;
    const poll = async () => {
      try {
        const { data: d } = await api.post<Progress>("/debrid/progress", { url });
        if (cancelled) return;
        setData(d);
        setError(null);
        if (!d.supported) return; // nothing to follow
        if (d.found && d.status === "downloaded" && !done) {
          done = true;
          onReadyRef.current();
          return;
        }
        const p = d.progress ?? 0;
        if (p !== lastProgress) {
          lastProgress = p;
          lastChange = Date.now();
        }
        setStalled(Boolean(d.found && !d.seeders && Date.now() - lastChange > STALLED_MS));
      } catch {
        if (!cancelled) setError(t("No se pudo consultar a tu debrid. Reintentando…"));
      }
      if (!cancelled) timer = window.setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [url]);

  if (!data?.supported && !error) return null;
  const progress = Math.max(0, Math.min(100, data?.progress ?? 0));
  let line: string;
  if (error) line = error;
  else if (!data?.found) line = t("Esperando a que tu debrid empiece la descarga…");
  else if (data.status === "downloaded") line = t("¡Listo! Empezando…");
  else if (FAILED.has(data.status ?? "")) line = t("Tu debrid no puede descargar este archivo. Elige otra fuente.");
  else if (WAITING.has(data.status ?? "")) line = t("En cola en tu debrid…");
  else
    line = [
      t("Descargando {p}%", { p: progress.toFixed(progress < 10 ? 1 : 0) }),
      data.speed ? speedLabel(data.speed) : null,
      data.seeders != null ? t("{n} fuentes", { n: data.seeders }) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  return (
    <div className="flex w-full max-w-sm flex-col gap-2" role="status" aria-live="polite">
      <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-primary transition-[width] duration-700" style={{ width: `${data?.found ? progress : 0}%` }} />
      </div>
      <p className="text-sm text-white/80">{line}</p>
      {stalled && (
        <p className="text-xs text-yellow-300">
          {t("Sin fuentes y sin avance desde hace un rato: probablemente no termine. Mejor elige otra fuente.")}
        </p>
      )}
    </div>
  );
}
