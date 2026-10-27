import { Pause, Play, RotateCcw, RotateCw, Volume1, Volume2, VolumeX } from "lucide-react";
import type { ReactNode } from "react";
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

export function ControlBar({ playback, visible, onTogglePlay, onSeek, onSkip, onVolume, onToggleMute, right }: ControlBarProps) {
  const { paused, currentTime, duration, buffered, volume, muted } = playback;
  const pct = duration ? (currentTime / duration) * 100 : 0;
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
      <div className="group relative flex h-5 items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-white/20 transition-all group-hover:h-1.5">
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/35" style={{ width: `${bufferedPct}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div
          className="pointer-events-none absolute size-3.5 -translate-x-1/2 rounded-full bg-primary opacity-0 shadow transition-opacity group-hover:opacity-100"
          style={{ left: `${pct}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={1}
          value={currentTime}
          onChange={(e) => onSeek(Number(e.target.value))}
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
        {/* Phones use their volume buttons (iOS ignores page volume). */}
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
            className="w-0 cursor-pointer accent-[var(--primary)] opacity-0 transition-all group-hover/vol:w-20 group-hover/vol:opacity-100 focus-visible:w-20 focus-visible:opacity-100"
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
