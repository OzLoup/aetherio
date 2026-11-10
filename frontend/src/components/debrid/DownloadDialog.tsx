import { Download as DownloadIcon, ListVideo, Loader2, Play, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getErrorDetail } from "@/api/client";
import {
  getDebridAccount,
  getDownload,
  playableLink,
  removeDownload,
  startDownload,
  type DebridAccount,
  type Download,
} from "@/api/debrid";
import type { ProgressContext } from "@/api/progress";
import { DownloadStatus } from "@/components/debrid/DownloadStatus";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { torrentRef, type ParsedStream } from "@/lib/streams";
import { t } from "@/i18n";

const POLL_MS = 4000;

type Step = "loading" | "confirm" | "starting" | "following" | "legacy";

/** Picking a source that isn't in the debrid yet: ask first, then ask
 * Real-Debrid for it and show the download live, before the player.
 * Without a saved key (or a source with no torrent behind it) it falls back
 * to the old flow: open the addon's link and let it ask the debrid. */
export function DownloadDialog({
  stream,
  videoId,
  context,
  alreadyThere,
  readyAlternative,
  onClose,
  onPlay,
  onLegacy,
  onPlayAlternative,
}: {
  stream: ParsedStream | null;
  videoId: string;
  context: ProgressContext;
  /** The torrent is already in the account (shown with its % in the list). */
  alreadyThere: boolean;
  readyAlternative?: ParsedStream;
  onClose: () => void;
  onPlay: (url: string) => void;
  onLegacy: (s: ParsedStream) => void;
  onPlayAlternative: (s: ParsedStream) => void;
}) {
  const [step, setStep] = useState<Step>("loading");
  const [account, setAccount] = useState<DebridAccount | null>(null);
  const [download, setDownload] = useState<Download | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const ref = stream ? torrentRef(stream.stream) : null;

  // Fresh state for every source picked.
  useEffect(() => {
    if (!stream) return;
    setDownload(null);
    setError(null);
    setStep("loading");
    let cancelled = false;
    // One more try before falling back to the old flow (a passing hiccup).
    getDebridAccount()
      .catch(() => new Promise<void>((r) => window.setTimeout(r, 1500)).then(() => getDebridAccount()))
      .then((a) => {
        if (cancelled) return;
        setAccount(a);
        const usable = a.connected && a.valid !== false && ref;
        if (!usable) setStep("legacy");
        else if (alreadyThere) void begin();
        else setStep("confirm");
      })
      .catch(() => !cancelled && setStep("legacy"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream]);

  // Follow it while the dialog is open.
  const following = step === "following" && download && !download.ready && !download.failed;
  useEffect(() => {
    if (!following || !download) return;
    const timer = window.setTimeout(() => {
      getDownload(download.id)
        .then((d) => {
          setDownload(d);
          setError(null);
        })
        .catch(() => setError(t("No se pudo consultar a tu debrid. Reintentando…")));
    }, POLL_MS);
    return () => window.clearTimeout(timer);
  }, [following, download]);

  async function begin() {
    if (!stream || !ref) return;
    setStep("starting");
    setError(null);
    try {
      const d = await startDownload(ref, videoId, context, {
        name: stream.stream.name,
        title: stream.stream.title,
        description: stream.stream.description,
        headline: stream.headline,
        quality: stream.quality ?? undefined,
        size: stream.size ?? undefined,
        languages: stream.languages,
        behaviorHints: stream.stream.behaviorHints,
      });
      setDownload(d);
      setStep("following");
    } catch (e) {
      setError(getErrorDetail(e) ?? t("Algo salió mal"));
      setStep("confirm");
    }
  }

  async function play() {
    if (!download) return;
    setOpening(true);
    try {
      const { url } = await playableLink(download.id);
      onPlay(url);
    } catch (e) {
      setError(getErrorDetail(e) ?? t("Algo salió mal"));
    } finally {
      setOpening(false);
    }
  }

  async function cancel() {
    if (!download) return;
    await removeDownload(download.id, true).catch(() => {});
    onClose();
  }

  const alternativeLabel = readyAlternative
    ? t("Ver uno listo ({info})", { info: [readyAlternative.quality ?? "?", readyAlternative.size].filter(Boolean).join(" · ") })
    : null;

  return (
    <Dialog open={stream !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {step === "loading" || step === "starting" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-6 animate-spin" />
            {step === "starting" ? t("Pidiendo la descarga a Real-Debrid…") : t("Revisando tu debrid…")}
          </div>
        ) : step === "legacy" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("Este stream todavía no está listo")}</DialogTitle>
              <DialogDescription>
                {t("Todavía no está en la caché de tu servicio debrid. Si lo eliges, empezará a descargarlo y podrás verlo cuando termine (de minutos a horas). Los marcados con ⚡ Listo empiezan al instante.")}
              </DialogDescription>
            </DialogHeader>
            {!account?.connected ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                {t("Para ver el progreso de la descarga, conecta tu Real-Debrid en")}{" "}
                <Link to="/settings#debrid" className="text-primary underline" onClick={onClose}>
                  {t("Ajustes")}
                </Link>
                .
              </p>
            ) : account.valid === false ? (
              <p className="rounded-lg bg-muted px-3 py-2 text-sm text-warning">
                {t("Tu clave de Real-Debrid ya no funciona. Revísala en Ajustes.")}
              </p>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => stream && onLegacy(stream)}>
                {t("Pedir descarga")}
              </Button>
              {readyAlternative ? (
                <Button onClick={() => onPlayAlternative(readyAlternative)}>{alternativeLabel}</Button>
              ) : (
                <Button onClick={onClose}>{t("Elegir otro")}</Button>
              )}
            </DialogFooter>
          </>
        ) : step === "confirm" ? (
          <>
            <DialogHeader>
              <DialogTitle>{t("¿Descargar en Real-Debrid?")}</DialogTitle>
              <DialogDescription>
                {t("Esta fuente todavía no está en tu debrid. Podemos pedirle que la descargue y te mostramos el avance aquí y en Descargas. Puede tardar de minutos a horas, según cuántas fuentes tenga el torrent.")}
              </DialogDescription>
            </DialogHeader>
            {stream && (
              <p className="truncate rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground" title={ref?.filename ?? stream.headline}>
                {[stream.quality, stream.size, ref?.filename ?? stream.headline].filter(Boolean).join(" · ")}
              </p>
            )}
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              {readyAlternative && (
                <Button variant="outline" onClick={() => onPlayAlternative(readyAlternative)}>
                  {alternativeLabel}
                </Button>
              )}
              <Button variant="outline" onClick={onClose}>
                {t("Cancelar")}
              </Button>
              <Button onClick={() => void begin()} autoFocus>
                <DownloadIcon />
                {t("Descargar")}
              </Button>
            </DialogFooter>
          </>
        ) : (
          download && (
            <>
              <DialogHeader>
                <DialogTitle>{download.ready ? t("¡Listo para ver!") : t("Descargando en tu debrid")}</DialogTitle>
                <DialogDescription>
                  {download.ready
                    ? t("El archivo ya está en tu Real-Debrid.")
                    : t("Puedes cerrar esto: la descarga sigue en Real-Debrid y la ves en Descargas.")}
                </DialogDescription>
              </DialogHeader>
              <DownloadStatus status={download} />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <DialogFooter>
                {!download.ready && (
                  <Button variant="outline" className="text-destructive" onClick={() => void cancel()}>
                    <Trash2 />
                    {t("Cancelar descarga")}
                  </Button>
                )}
                {download.failed ? (
                  <>
                    {/* Asks for it again: the failed torrent is deleted and re-added. */}
                    <Button variant={readyAlternative ? "outline" : "default"} onClick={() => void begin()} autoFocus={!readyAlternative}>
                      <RotateCw />
                      {t("Reintentar")}
                    </Button>
                    {readyAlternative && (
                      <Button onClick={() => onPlayAlternative(readyAlternative)} autoFocus>
                        {alternativeLabel}
                      </Button>
                    )}
                  </>
                ) : download.ready ? (
                  <Button onClick={() => void play()} disabled={opening} autoFocus>
                    {opening ? <Loader2 className="animate-spin" /> : <Play />}
                    {t("Reproducir")}
                  </Button>
                ) : (
                  <Link to="/downloads" onClick={onClose} className={buttonVariants()} autoFocus>
                    <ListVideo />
                    {t("Ir a Descargas")}
                  </Link>
                )}
              </DialogFooter>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}
