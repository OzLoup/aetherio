import { mediaSupport } from "@/lib/browser";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { castDiagnostics, guessContentType, loadCastSdk } from "@/lib/cast";
import { desktop, type CastDevice, type DesktopCastMedia } from "@/lib/desktop";
import { t } from "@/i18n";

export type CastKind = "googlecast" | "airplay" | "remote" | "desktop";

interface SafariVideo extends HTMLVideoElement {
  webkitShowPlaybackTargetPicker?: () => void;
  webkitCurrentPlaybackTargetIsWireless?: boolean;
}

export interface RemoteState {
  device: string;
  paused: boolean;
  currentTime: number;
  duration: number;
}

interface Media {
  url: string;
  title: string;
  filename?: string;
}

export interface CastError {
  stage: "connect" | "load";
  message: string;
}

/**
 * Sending the video to a TV, with whatever the browser offers:
 * - Google Cast SDK (Chrome, also Android): Chromecast, Google TV, TVs with
 *   Chromecast built-in. The TV fetches the URL itself; we only remote-control.
 * - AirPlay (Safari): Apple TV, AirPlay TVs, Roku 4K with AirPlay.
 * - Remote Playback API: the generic fallback some browsers implement.
 * Subtitles aren't sent yet (the TV can't read the blob: URLs we use).
 */
export function useCasting(
  videoRef: RefObject<HTMLVideoElement | null>,
  media: Media,
  /** Load into the TV right away if a cast session is already open (we got
   * here by switching to a TV-friendly stream while casting). */
  autoCast = false,
  /** macOS app: how to cast right now, and where to resume locally after. */
  opts: { desktopMedia?: () => DesktopCastMedia; onStopAt?: (t: number) => void } = {},
) {
  const optsRef = useRef(opts);
  useEffect(() => {
    optsRef.current = opts;
  });
  const [devices, setDevices] = useState<CastDevice[]>([]);
  // Latest remote state for commands (state updaters must stay pure).
  const remoteRef = useRef<RemoteState | null>(null);
  const [kind, setKind] = useState<CastKind | null>(null);
  const [remote, setRemote] = useState<RemoteState | null>(null);
  const [error, setError] = useState<CastError | null>(null);
  const [castState, setCastState] = useState<string | null>(null);
  const playerRef = useRef<cast.framework.RemotePlayer | null>(null);
  const controllerRef = useRef<cast.framework.RemotePlayerController | null>(null);
  const mediaRef = useRef(media);
  useEffect(() => {
    mediaRef.current = media;
  });

  // --- macOS app: our own Chromecast/DLNA casting (Electron has no Cast SDK) ---
  useEffect(() => {
    const dc = desktop?.cast;
    if (!dc) return;
    setKind("desktop");
    dc.list().then(setDevices).catch(() => {});
    const offDevices = dc.onDevices(setDevices);
    const offStatus = dc.onStatus((st) => {
      if (st.state === "IDLE") {
        if (st.idleReason === "ERROR") {
          setError({ stage: "load", message: t("La TV no pudo reproducir este video.") });
        }
        if (st.idleReason) setRemote(null);
        return;
      }
      setRemote((prev) =>
        prev
          ? { ...prev, paused: st.state === "PAUSED", currentTime: st.currentTime || prev.currentTime, duration: st.duration ?? prev.duration }
          : prev,
      );
    });
    return () => {
      offDevices();
      offStatus();
    };
  }, []);

  // --- detect what's available ---
  useEffect(() => {
    const video = videoRef.current as SafariVideo | null;
    if (!video || desktop?.cast) return;
    let cancelled = false;
    const cleanups: (() => void)[] = [];

    // AirPlay (Safari): the picker exists only there.
    if (typeof video.webkitShowPlaybackTargetPicker === "function") {
      // iPhone/iPad: AirPlay is the only way out of any iOS browser, and the
      // "available" event often never fires in Edge/Chrome. Always offer the
      // system picker (it says so itself when there's nothing nearby).
      if (mediaSupport().ios) {
        setKind("airplay");
        return;
      }
      const onAvail = (e: Event) => {
        if ((e as Event & { availability?: string }).availability === "available") setKind((k) => k ?? "airplay");
      };
      video.addEventListener("webkitplaybacktargetavailabilitychanged", onAvail);
      cleanups.push(() => video.removeEventListener("webkitplaybacktargetavailabilitychanged", onAvail));
    }

    loadCastSdk().then((ok) => {
      if (cancelled) return;
      if (!ok) {
        // Generic Remote Playback API, if the browser has it.
        const rp = video.remote;
        if (rp && typeof rp.watchAvailability === "function") {
          rp.watchAvailability((available) => setKind((k) => k ?? (available ? "remote" : null))).catch(() => {});
        }
        return;
      }
      const context = cast.framework.CastContext.getInstance();
      // With the SDK up, always offer Cast: the browser's own device picker
      // does the discovery. Some Chromium browsers (Edge) see devices in
      // their picker without ever reporting them to the page.
      setKind("googlecast");
      const update = () => setCastState(context.getCastState());
      update();
      context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, update);
      cleanups.push(() => context.removeEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, update));

      // Mirror the TV's state so our overlay can control it.
      const player = new cast.framework.RemotePlayer();
      const controller = new cast.framework.RemotePlayerController(player);
      playerRef.current = player;
      controllerRef.current = controller;
      const sync = () => {
        if (!player.isConnected) {
          setRemote(null);
          return;
        }
        setRemote({
          device: context.getCurrentSession()?.getCastDevice().friendlyName ?? "TV",
          paused: player.isPaused,
          currentTime: player.currentTime,
          duration: player.duration,
        });
      };
      controller.addEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, sync);
      cleanups.push(() => controller.removeEventListener(cast.framework.RemotePlayerEventType.ANY_CHANGE, sync));
    });

    return () => {
      cancelled = true;
      cleanups.forEach((c) => c());
    };
  }, [videoRef]);

  const loadIntoSession = useCallback(async () => {
    const video = videoRef.current;
    const session = cast.framework.CastContext.getInstance().getCurrentSession();
    if (!session) return;
    const { url, title, filename } = mediaRef.current;
    const info = new chrome.cast.media.MediaInfo(url, guessContentType(url, filename));
    const metadata = new chrome.cast.media.MovieMediaMetadata();
    metadata.title = title;
    info.metadata = metadata;
    const request = new chrome.cast.media.LoadRequest(info);
    request.currentTime = video?.currentTime ?? 0;
    request.autoplay = true;
    try {
      await session.loadMedia(request);
      video?.pause();
    } catch (err) {
      console.warn("[cast] load failed:", err);
      setError({
        stage: "load",
        message: t("La TV se conectó pero no pudo reproducir este archivo. Suele pasar con MKV."),
      });
    }
  }, [videoRef]);

  const start = useCallback(async () => {
    const video = videoRef.current as SafariVideo | null;
    if (!video) return;
    setError(null);
    if (kind === "airplay") {
      video.webkitShowPlaybackTargetPicker?.();
      return;
    }
    if (kind === "remote") {
      video.remote.prompt().catch(() => {});
      return;
    }
    if (kind !== "googlecast") return;
    const context = cast.framework.CastContext.getInstance();
    if (!context.getCurrentSession()) {
      try {
        await context.requestSession();
      } catch (err) {
        const code = typeof err === "string" ? err : (err as { code?: string })?.code;
        console.warn("[cast] connect failed:", code, err);
        if (code === "cancel") return; // the user closed the device picker
        setError({
          stage: "connect",
          message:
            code === "receiver_unavailable"
              ? t("No encontramos una TV compatible con Chromecast en tu red.")
              : t("No se pudo conectar con la TV. Revisa que esté encendida y en la misma red Wi-Fi, y vuelve a intentar."),
        });
        return;
      }
    }
    await loadIntoSession();
  }, [kind, videoRef, loadIntoSession]);

  // Arrived here by switching streams while casting: send the new one.
  useEffect(() => {
    if (!autoCast || kind !== "googlecast") return;
    if (cast.framework.CastContext.getInstance().getCurrentSession()) loadIntoSession();
  }, [autoCast, kind, loadIntoSession]);

  /** macOS app: cast to a device picked in our own device list. */
  useEffect(() => {
    remoteRef.current = remote;
  }, [remote]);

  const castTo = useCallback(
    async (deviceId: string) => {
      const dc = desktop?.cast;
      const media = optsRef.current.desktopMedia?.();
      if (!dc || !media) return;
      setError(null);
      const name = devices.find((d) => d.id === deviceId)?.name ?? "TV";
      try {
        await dc.play(deviceId, media);
        videoRef.current?.pause();
        setRemote({ device: name, paused: false, currentTime: media.start, duration: media.duration ?? 0 });
      } catch (err) {
        console.warn("[cast] desktop play failed", err);
        setError({
          stage: "connect",
          message: t("No se pudo transmitir a {name}. Revisa que esté encendida y en la misma red Wi-Fi.", { name }),
        });
      }
    },
    [devices, videoRef],
  );

  const togglePause = useCallback(() => {
    const dc = desktop?.cast;
    if (dc) {
      const r = remoteRef.current;
      if (!r) return;
      (r.paused ? dc.resume() : dc.pause()).catch(() => {});
      setRemote({ ...r, paused: !r.paused });
      return;
    }
    controllerRef.current?.playOrPause();
  }, []);

  const seekBy = useCallback((seconds: number) => {
    if (desktop?.cast) {
      const r = remoteRef.current;
      if (!r) return;
      const t = Math.max(0, Math.min(r.duration || Infinity, r.currentTime + seconds));
      desktop.cast.seek(t).catch(() => {});
      setRemote({ ...r, currentTime: t });
      return;
    }
    const player = playerRef.current;
    const controller = controllerRef.current;
    if (!player || !controller) return;
    player.currentTime = Math.max(0, Math.min(player.duration || Infinity, player.currentTime + seconds));
    controller.seek();
  }, []);

  const seekTo = useCallback((seconds: number) => {
    if (desktop?.cast) {
      desktop.cast.seek(seconds).catch(() => {});
      setRemote((r) => (r ? { ...r, currentTime: seconds } : r));
      return;
    }
    const player = playerRef.current;
    const controller = controllerRef.current;
    if (!player || !controller) return;
    player.currentTime = seconds;
    controller.seek();
  }, []);

  /** Stop casting and keep watching here from the same minute. */
  const stop = useCallback(() => {
    if (desktop?.cast) {
      const r = remoteRef.current;
      setRemote(null);
      desktop.cast.stop().catch(() => {});
      if (r) optsRef.current.onStopAt?.(r.currentTime);
      return;
    }
    const at = playerRef.current?.currentTime ?? 0;
    cast.framework.CastContext.getInstance().endCurrentSession(true);
    const video = videoRef.current;
    if (video) {
      if (at > 0) video.currentTime = at;
      video.play().catch(() => {});
    }
  }, [videoRef]);

  const diagnostics = `Google Cast: ${castDiagnostics.sdk}${castDiagnostics.reason ? ` (${castDiagnostics.reason})` : ""}${
    castState ? ` · ${castState}` : ""
  } · AirPlay: ${typeof (videoRef.current as SafariVideo | null)?.webkitShowPlaybackTargetPicker === "function" ? t("sí") : "no"}`;

  return {
    kind,
    remote,
    error,
    diagnostics,
    devices,
    refreshDevices: () => desktop?.cast?.refresh().catch(() => {}),
    castTo,
    clearError: () => setError(null),
    start,
    togglePause,
    seekBy,
    seekTo,
    stop,
  };
}
