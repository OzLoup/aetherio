import { useEffect, useRef, useState } from "react";
import type { TorrentStatus } from "@/api/debrid";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

// No progress and no seeds for this long: it most likely won't finish.
const STALLED_MS = 90_000;
const WAITING = new Set(["magnet_conversion", "waiting_files_selection", "queued"]);
const BUSY = new Set(["compressing", "uploading"]);

export function speedLabel(bytesPerSecond: number) {
  const mb = bytesPerSecond / 1_000_000;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bytesPerSecond / 1000)} KB/s`;
}

export function percentLabel(p: number) {
  return `${p.toFixed(p > 0 && p < 10 ? 1 : 0)}%`;
}

/** Short state for a badge ("45%", "En cola", "Listo"…). */
export function shortStatus(s: TorrentStatus) {
  if (s.ready) return t("Descargado");
  if (s.status === "removed") return t("Quitado de tu debrid");
  if (s.failed) return t("Falló");
  if (WAITING.has(s.status)) return t("En cola");
  if (BUSY.has(s.status)) return t("Terminando…");
  return percentLabel(s.progress);
}

/** One line saying how it's going. */
export function statusLine(s: TorrentStatus) {
  if (s.ready) return t("¡Descargado! Ya puedes verlo.");
  if (s.status === "removed") return t("Esta descarga ya no está en tu cuenta de Real-Debrid.");
  if (s.failed) return t("Tu debrid no puede descargar este archivo (torrent muerto o con error). Elige otra fuente.");
  if (s.status === "magnet_conversion") return t("Tu debrid está buscando el torrent…");
  if (WAITING.has(s.status)) return t("En cola en tu debrid…");
  if (BUSY.has(s.status)) return t("Casi listo: tu debrid está preparando el archivo…");
  return [
    t("Descargando {p}", { p: percentLabel(s.progress) }),
    s.speed ? speedLabel(s.speed) : null,
    s.seeders != null ? t("{n} fuentes", { n: s.seeders }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** True when it has had no seeds and no progress for a while. */
export function useStalled(s: TorrentStatus | null) {
  const last = useRef<{ progress: number; at: number } | null>(null);
  const [stalled, setStalled] = useState(false);
  useEffect(() => {
    if (!s || s.ready || s.failed) {
      setStalled(false);
      return;
    }
    if (!last.current || last.current.progress !== s.progress) last.current = { progress: s.progress, at: Date.now() };
    setStalled(!s.seeders && Date.now() - last.current.at > STALLED_MS);
  }, [s]);
  return stalled;
}

/** Bar + status line (+ a warning when it looks stuck). */
export function DownloadStatus({ status, className }: { status: TorrentStatus; className?: string }) {
  const stalled = useStalled(status);
  const waiting = WAITING.has(status.status);
  return (
    <div className={cn("flex flex-col gap-1.5", className)} role="status" aria-live="polite">
      <Progress
        value={status.ready ? 100 : status.progress}
        indicatorClassName={cn(status.ready && "bg-success", status.failed && "bg-destructive", waiting && "animate-pulse")}
      />
      <p className={cn("text-sm", status.failed ? "text-destructive" : "text-muted-foreground")}>{statusLine(status)}</p>
      {stalled && (
        <p className="text-xs text-warning">
          {t("Sin fuentes y sin avance desde hace un rato: probablemente no termine. Mejor elige otra fuente.")}
        </p>
      )}
    </div>
  );
}
