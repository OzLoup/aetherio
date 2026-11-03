import { Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { Playback } from "@/hooks/usePlayback";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

/** Round icon button for the control bar (big enough for touch and TV). */
export function BarButton({
  label,
  onClick,
  active,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "flex h-10 min-w-10 items-center justify-center gap-1.5 rounded-full px-2 text-white transition-colors hover:bg-white/15 focus-visible:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white [&_svg]:size-5",
        active && "bg-white/15",
        className,
      )}
    >
      {children}
    </button>
  );
}

interface ControlBarProps {
  playback: Playback;
  visible: boolean;
  onTogglePlay: () => void;
  onSeek: (seconds: number) => void;
  onSkip: (delta: number) => void;
  onVolume: (volume: number) => void;
  onToggleMute: () => void;
  /** Buttons on the right: language, subtitles, cast, fullscreen. */
  right: ReactNode;
}

// How long the bar trusts a requested position before showing the real one
// again (the Mac/Windows app may re-prepare the video from that point).
const PENDING_MS = 30_000;

export function ControlBar({ playback, visible, onTogglePlay, onSeek, onSkip, onVolume, onToggleMute, right }: ControlBarProps) {
  const { paused, duration, buffered, volume, muted } = playback;
  // Where we asked to go: shown right away instead of waiting for the video.
  const [pending, setPending] = useState<{ to: number; at: number } | null>(null);
  // Dragging the bar: preview only, the jump happens on release.
  const [drag, setDrag] = useState<number | null>(null);
  const dragging = useRef(false);
  // Pointer over the bar: the time under it.
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    if (!pending) return;
    // The video got there (or it's taking too long): show the real time again.
    const arrived = Math.abs(playback.currentTime - pending.to) < 3;
    const wait = arrived ? 0 : Math.max(0, pending.at + PENDING_MS - Date.now());
    const timer = window.setTimeout(() => setPending(null), wait);
    return () => window.clearTimeout(timer);
  }, [pending, playback.currentTime]);

  function seekTo(seconds: number) {
    const to = Math.max(0, Math.min(duration || seconds, seconds));
    setPending({ to, at: Date.now() });
    onSeek(to);
  }

  const currentTime = drag ?? pending?.to ?? playback.currentTime;
  const seekingNow = pending !== null && drag === null;
  const pct = duration ? (currentTime / duration) * 100 : 0;
  const preview = drag ?? hover;
  const previewPct = duration && preview !== null ? Math.min(100, Math.max(0, (preview / duration) * 100)) : 0;

  function timeAt(e: ReactPointerEvent<HTMLElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const share = box.width ? Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)) : 0;
    return share * duration;
  }

  function endDrag() {
    if (!dragging.current) return;
    dragging.current = false;
    if (drag !== null) seekTo(drag);
    setDrag(null);
  }
  const bufferedPct = duration ? Math.min(100, (buffered / duration) * 100) : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <div
      className={cn(
        "absolute inset-x-0 bottom-0 z-10 flex flex-col gap-1 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-10 transition-opacity duration-300",
        visible ? "opacity-100" : "pointer-events-none opacity-0",
      )}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Phones: the time goes above the bar so every button fits. */}
      <span className="select-none text-xs tabular-nums text-white/90 sm:hidden">
        {formatTime(currentTime)} <span className="text-white/50">/ {formatTime(duration)}</span>
      </span>
      {/* Progress: played / buffered, with a native range on top for input. */}
      <div
        className="group relative flex h-5 items-center"
        onPointerMove={(e) => duration && e.pointerType === "mouse" && setHover(timeAt(e))}
        onPointerLeave={() => setHover(null)}
      >
        {preview !== null && duration > 0 && (
          <div
            className="pointer-events-none absolute bottom-full mb-2 -translate-x-1/2 rounded-md bg-black/85 px-2 py-1 text-xs font-medium tabular-nums text-white shadow"
            style={{ left: `clamp(1.75rem, ${previewPct}%, calc(100% - 1.75rem))` }}
          >
            {formatTime(preview)}
          </div>
        )}
        <div className="absolute inset-x-0 h-1 rounded-full bg-white/20 transition-all group-hover:h-1.5">
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${bufferedPct}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div
          className={cn(
            "pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full bg-primary shadow transition-opacity group-hover:opacity-100",
            drag !== null || seekingNow ? "opacity-100" : "opacity-0",
            seekingNow && "animate-pulse",
          )}
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={currentTime}
          onPointerDown={() => {
            dragging.current = true;
          }}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onBlur={endDrag}
          onChange={(e) => {
            const value = Number(e.target.value);
            // Mouse/touch drag: preview; keyboard/remote: jump now.
            if (dragging.current) setDrag(value);
            else seekTo(value);
          }}
          className="absolute inset-0 w-full cursor-pointer opacity-0"
          aria-label={t("Posición")}
          aria-valuetext={t("{a} de {b}", { a: formatTime(currentTime), b: formatTime(duration) })}
        />
      </div>

      <div className="flex items-center gap-0.5 sm:gap-1">
        <BarButton label={paused ? t("Reproducir") : t("Pausar")} onClick={onTogglePlay}>
          {paused ? <Play className="fill-current" /> : <Pause className="fill-current" />}
        </BarButton>
        <BarButton label={t("Atrasar 10 segundos")} onClick={() => onSkip(-10)}>
          <RotateCcw />
        </BarButton>
        <BarButton label={t("Adelantar 10 segundos")} onClick={() => onSkip(10)}>
          <RotateCw />
        </BarButton>
        {/* Phones use their volume buttons (iOS ignores page volume). The
            slider opens on hover, or when the mute button gets focus (TV
            remote: then right reaches it, left/right set the volume). */}
        <div className="group/vol hidden items-center sm:flex">
          <BarButton label={muted ? t("Activar sonido") : t("Silenciar")} onClick={onToggleMute}>
            <VolumeIcon />
          </BarButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            className="w-0 cursor-pointer accent-[var(--primary)] opacity-0 transition-all group-hover/vol:w-20 group-hover/vol:opacity-100 group-focus-within/vol:w-20 group-focus-within/vol:opacity-100"
            aria-label={t("Volumen")}
          />
        </div>
        <span className="ml-2 hidden select-none text-sm tabular-nums text-white/90 sm:inline">
          {formatTime(currentTime)} <span className="text-white/50">/ {formatTime(duration)}</span>
        </span>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">{right}</div>
      </div>
    </div>
  );
}
