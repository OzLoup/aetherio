import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
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

/** Live progress of the debrid download behind `url` (Torrentio + Real-
 * Debrid for now). Calls `onReady` once the file is downloaded, so the
 * player can start right away. Shows nothing for unsupported sources. */
export function DebridProgress({ url, onReady }: { url: string; onReady: () => void }) {
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
