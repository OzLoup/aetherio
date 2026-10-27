import { Cast, Loader2, Pause, Play, RefreshCw, RotateCcw, RotateCw, Settings, Tv, X } from "lucide-react";
import { useEffect, useState } from "react";
import { desktop } from "@/lib/desktop";
import { mediaSupport } from "@/lib/browser";
import type { CastDevice } from "@/lib/desktop";
import { Button } from "@/components/ui/button";
import type { RemoteState } from "@/hooks/useCasting";
import { formatTime } from "@/lib/format";
import { t } from "@/i18n";

/** Covers the local player while the TV plays: this device is the remote. */
export function CastingOverlay({
  remote,
  title,
  onTogglePause,
  onSeekBy,
  onSeekTo,
  onStop,
  note,
}: {
  remote: RemoteState;
  title: string;
  onTogglePause: () => void;
  onSeekBy: (s: number) => void;
  onSeekTo: (s: number) => void;
  onStop: () => void;
  /** Footnote (e.g. whether subtitles reach the TV). */
  note?: string;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-neutral-950 p-6">
      <div className="flex w-full max-w-lg flex-col items-center gap-6 text-center">
        <div className="flex size-16 items-center justify-center rounded-full bg-primary/20">
          <Cast className="size-8 text-primary" />
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-sm text-white/60">{t("Transmitiendo a")}</p>
          <p className="text-2xl font-semibold">{remote.device}</p>
          <p className="truncate text-sm text-white/70">{title}</p>
        </div>

        <div className="flex w-full flex-col gap-1">
          <input
            type="range"
            min={0}
            max={remote.duration || 0}
            step={1}
            value={remote.currentTime}
            onChange={(e) => onSeekTo(Number(e.target.value))}
            className="w-full accent-[var(--primary)]"
            aria-label={t("Posición")}
          />
          <div className="flex justify-between text-xs text-white/60">
            <span>{formatTime(remote.currentTime)}</span>
            <span>{formatTime(remote.duration)}</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Button variant="ghost" size="lg" className="text-white hover:bg-white/10" onClick={() => onSeekBy(-10)} aria-label={t("Atrasar 10 segundos")}>
            <RotateCcw />
            10
          </Button>
          <Button size="lg" className="size-16 rounded-full" onClick={onTogglePause} autoFocus aria-label={remote.paused ? t("Reproducir") : t("Pausar")}>
            {remote.paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
          </Button>
          <Button variant="ghost" size="lg" className="text-white hover:bg-white/10" onClick={() => onSeekBy(10)} aria-label={t("Adelantar 10 segundos")}>
            10
            <RotateCw />
          </Button>
        </div>

        <Button variant="outline" size="lg" className="border-white/30 text-white hover:bg-white/10" onClick={onStop}>
          <X />
          {t("Dejar de transmitir y ver aquí")}
        </Button>
        {note && <p className="text-xs text-white/50">{note}</p>}
      </div>
    </div>
  );
}

/** Shown when this browser has no way to cast: how to do it elsewhere. */
export function CastHelp({ onClose, diagnostics }: { onClose: () => void; diagnostics?: string }) {
  const isEdge = navigator.userAgent.includes("Edg/");
  return (
    <div className="absolute bottom-24 right-4 z-20 w-80 rounded-lg border border-white/15 bg-black/90 p-4 text-sm shadow-xl">
      <div className="mb-2 flex items-center justify-between">
        <p className="font-semibold">{t("Transmitir a la TV")}</p>
        <button onClick={onClose} aria-label={t("Cerrar")} className="text-white/60 hover:text-white">
          <X className="size-4" />
        </button>
      </div>
      <p className="mb-3 text-white/70">
        {t("No encontramos dispositivos desde este navegador. Asegúrate de que la TV esté en la misma red Wi-Fi.")}
      </p>
      {mediaSupport().ios ? (
        <ul className="flex flex-col gap-2 text-white/80">
          <li>
            <strong>{t("Apple TV, TVs con AirPlay y Roku compatibles:")}</strong>{" "}
            {t("desde el iPhone solo se puede transmitir por AirPlay.")}
          </li>
          <li>{t("Chromecast no funciona desde los navegadores del iPhone. Usa la app en una computadora con Chrome o Edge.")}</li>
        </ul>
      ) : (
      <ul className="flex flex-col gap-2 text-white/80">
        <li>
          <strong>{t("Chromecast / Google TV:")}</strong> {t("abre la app en")} <strong>Chrome</strong>.
        </li>
        <li>
          <strong>{t("Apple TV, TVs con AirPlay y Roku 4K:")}</strong> {t("abre la app en")} <strong>Safari</strong> {t("(Mac o iPhone).")}
        </li>
        {isEdge && (
          <li>
            <strong>{t("En Edge:")}</strong>{" "}
            {t("menú ⋯ → Más herramientas → Transmitir contenido multimedia a un dispositivo (envía la pestaña completa).")}
          </li>
        )}
      </ul>
      )}
      {diagnostics && <p className="mt-3 break-words border-t border-white/10 pt-2 text-[11px] text-white/40">{diagnostics}</p>}
    </div>
  );
}

/** macOS app: TVs found on the local network. */
export function CastDevicePicker({
  devices,
  onPick,
  onRefresh,
  onClose,
}: {
  devices: CastDevice[];
  onPick: (id: string) => void;
  onRefresh: () => void;
  onClose: () => void;
}) {
  // Nothing after a few seconds: almost always macOS's Local Network
  // permission (blocked silently when denied).
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), 7000);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="absolute bottom-24 right-4 z-20 w-80 rounded-lg border border-white/15 bg-black/90 p-2 text-sm shadow-xl">
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <p className="font-semibold">{t("Transmitir a")}</p>
        <div className="flex items-center gap-1">
          <button onClick={onRefresh} aria-label={t("Buscar de nuevo")} title={t("Buscar de nuevo")} className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white">
            <RefreshCw className="size-4" />
          </button>
          <button onClick={onClose} aria-label={t("Cerrar")} className="rounded p-1 text-white/60 hover:bg-white/10 hover:text-white">
            <X className="size-4" />
          </button>
        </div>
      </div>
      {devices.length === 0 ? (
        <div className="flex flex-col gap-3 px-2 py-3">
          <p className="flex items-center gap-2 text-white/60">
            <Loader2 className="size-4 animate-spin" />
            {t("Buscando televisores en tu red…")}
          </p>
          {slow && (
            <div className="flex flex-col gap-2 rounded-md bg-yellow-400/10 p-3 text-xs text-yellow-100">
              <p>
                {t("¿No aparece ninguna? Revisa que macOS deje a AetherIO usar la red local:")}{" "}
                <strong>{t("Ajustes del Sistema → Privacidad y seguridad → Red local → AetherIO")}</strong>{" "}
                {t("activado. Después cierra y vuelve a abrir la app.")}
              </p>
              {desktop?.openLocalNetworkSettings && (
                <button
                  onClick={() => desktop!.openLocalNetworkSettings()}
                  className="flex w-fit items-center gap-1.5 rounded-md bg-white/15 px-3 py-1.5 font-medium text-white hover:bg-white/25"
                  autoFocus
                >
                  <Settings className="size-3.5" />
                  {t("Abrir ajustes de Red local")}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <ul className="flex flex-col">
          {devices.map((d, i) => (
            <li key={d.id}>
              <button
                onClick={() => onPick(d.id)}
                autoFocus={i === 0}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
              >
                {d.kind === "chromecast" ? <Cast className="size-5 shrink-0 text-primary" /> : <Tv className="size-5 shrink-0 text-primary" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{d.name}</span>
                  <span className="block text-xs text-white/50">{d.kind === "chromecast" ? t("Chromecast / Google TV") : t("Smart TV (DLNA)")}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 border-t border-white/10 px-2 pt-2 text-xs text-white/50">
        {t("La TV debe estar en la misma red Wi-Fi. La primera vez, macOS puede pedir permiso para usar la red local:")}
        acéptalo.
      </p>
    </div>
  );
}
