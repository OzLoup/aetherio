import { AlertTriangle, Airplay, ArrowLeft, Cast, Check, Copy, Download, Gauge, Languages, ListVideo, Loader2, Maximize, Minimize, Play, RotateCw, Subtitles, VolumeX, Wifi, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { CastDevicePicker, CastHelp, CastingOverlay } from "@/components/player/CastPanels";
import { BarButton, ControlBar } from "@/components/player/ControlBar";
import { Button } from "@/components/ui/button";
import { useProfiles } from "@/context/ProfileContext";
import { useAddons } from "@/hooks/useAddons";
import { useCasting } from "@/hooks/useCasting";
import { useDesktopSource } from "@/hooks/useDesktopSource";
import { useProgressSaver } from "@/hooks/useProgressSaver";
import { formatTime } from "@/lib/format";
import { usePlayback } from "@/hooks/usePlayback";
import { guessContentType, isMkv } from "@/lib/cast";
import { mediaSupport } from "@/lib/browser";
import { audioTrackLabel, embeddedSubtitleUrl, isTrackInLanguage, subtitleTrackLabel } from "@/lib/desktop";
import { languageInfo, streamLangLabel, subtitleLabel } from "@/lib/languages";
import { playerPath, streamsPath } from "@/lib/routes";
import { isDubbedFor, isMultiAudio, languageOptions, lighterOption, qualityOptions, type AltStream, type AudioChoice } from "@/lib/streams";
import { getSubtitles, type Extra, type Subtitle } from "@/lib/stremio";
import { chooseSubtitles, fetchSubtitleVtt, getSubsPref, setSubsPref, shiftVtt } from "@/lib/subtitles";
import { android } from "@/lib/android";
import { NativePlayer } from "./NativePlayer";
import type { PlayerState } from "./Streams";
import { t } from "@/i18n";

interface Track {
  id: string;
  label: string;
  srclang: string;
  /** WebVTT text (turned into a blob URL, shifted when streaming from a seek point). */
  vtt: string;
}


interface NativeAudioTrack {
  id: string;
  label: string;
  language: string;
  enabled: boolean;
}
type AudioTrackList = ArrayLike<NativeAudioTrack> & { length: number };

function choiceLabel(lang: AudioChoice) {
  return lang === "original" ? t("Original (sin doblaje marcado)") : streamLangLabel(lang);
}

export default function Player() {
  const { type = "", id = "" } = useParams();
  const state = useLocation().state as PlayerState | null;
  if (!state?.stream?.url) {
    // Reloaded the page: the chosen stream isn't kept, pick it again.
    return <Navigate to={streamsPath(type, id, "")} replace />;
  }
  // Android app: its own player (ExoPlayer) plays any format.
  if (android) return <NativePlayer key={state.stream.url} type={type} id={id} state={state} />;
  // Switching language swaps the stream: remount for a clean player.
  return <PlayerView key={state.stream.url} type={type} id={id} state={state} />;
}

function PlayerView({ type, id, state }: { type: string; id: string; state: PlayerState }) {
  const navigate = useNavigate();
  const { active } = useAddons();
  const { current } = useProfiles();
  const videoRef = useRef<HTMLVideoElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingSubs, setLoadingSubs] = useState(true);
  const [fatal, setFatal] = useState<string | null>(null);
  // The debrid service is still fetching the torrent and the addon handed us
  // its short "downloading" placeholder clip instead of the real file.
  const [downloading, setDownloading] = useState(false);
  const [warning, setWarning] = useState<{ kind: "audio" | "video"; title: string; detail: string } | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  // Index into `tracks` of the subtitle being shown, -1 = off.
  const [activeTrack, setActiveTrack] = useState(-1);
  const [menu, setMenu] = useState<"subs" | "lang" | "cast" | "quality" | null>(null);
  // Audio renditions inside an HLS stream (hls.js), shown in the language menu.
  const [hlsAudioTracks, setHlsAudioTracks] = useState<{ name: string; lang?: string }[]>([]);
  const [hlsAudioIndex, setHlsAudioIndex] = useState(-1);
  const hlsRef = useRef<{ audioTrack: number; currentLevel: number } | null>(null);
  // Quality levels inside an HLS stream (adaptive: "Automática" by default).
  const [hlsLevels, setHlsLevels] = useState<{ height: number; bitrate: number }[]>([]);
  const [hlsLevel, setHlsLevel] = useState(-1); // chosen; -1 = automatic
  const [hlsPlaying, setHlsPlaying] = useState(-1); // what's actually playing
  // Audio tracks inside the file, where the browser exposes them (Safari;
  // Chrome doesn't). Empty = not available.
  const [audioTracks, setAudioTracks] = useState<NativeAudioTrack[]>([]);
  const profileLangRef = useRef(current?.language ?? "es-419");
  profileLangRef.current = current?.language ?? "es-419";
  const [copied, setCopied] = useState(false);
  const hideTimer = useRef<number | undefined>(undefined);
  const { stream, title, dubbed, languages, alternatives = [], startAt } = state;
  const url = stream.url!;
  const proxyHeaders = stream.behaviorHints?.proxyHeaders?.request;
  // macOS app: real audio tracks + local ffmpeg server (no-op on the web).
  const desk = useDesktopSource({
    enabled: true,
    url,
    headers: proxyHeaders,
    language: current?.language ?? "es-419",
    startAt,
  });
  const deskRef = useRef(desk);
  useEffect(() => {
    deskRef.current = desk;
  });
  const playback = usePlayback(videoRef, desk.server ? { offset: desk.offset, duration: desk.duration } : undefined);
  // What the <video> actually plays: the original or the desktop server's
  // version. Null = not yet (the app is still analyzing the file).
  const srcUrl = desk.active ? desk.srcUrl : url;
  // Where to resume once the new source loads (the desktop server starts
  // at the right point by itself).
  const resumeAt = useRef<number | undefined>(desk.active ? undefined : startAt);
  const resumedDirect = useRef(false);
  useEffect(() => {
    if (desk.status === "ready" && !desk.server && !resumedDirect.current) {
      resumedDirect.current = true;
      resumeAt.current = startAt;
    }
    if (desk.status === "placeholder") setDownloading(true);
  }, [desk.status, desk.server, startAt]);
  // The TV fetches the file itself: never hand it our local server's URL.
  const casting = useCasting(videoRef, { url, title, filename: stream.behaviorHints?.filename }, state.castOnStart, {
    // macOS app: send the original link when the TV can take it as is,
    // otherwise the Mac re-packages it (MKV, AC3/DTS, chosen audio track).
    desktopMedia: () => ({
      title,
      url,
      headers: proxyHeaders,
      direct: desk.status !== "ready" || (!desk.server && !proxyHeaders),
      contentType: isHlsSource ? "application/x-mpegurl" : guessContentType(url, stream.behaviorHints?.filename),
      audio: desk.audio,
      videoCodec: desk.info?.video?.codec,
      videoMode: desk.videoMode,
      duration: desk.info?.duration ?? (playback.duration || null),
      start: playback.currentTime,
      vtt: activeTrack >= 0 ? tracks[activeTrack]?.vtt : undefined,
    }),
    onStopAt: (t) => {
      seek(t);
      videoRef.current?.play().catch(() => {});
    },
  });
  // For when the TV rejects this file: same language, ready, not MKV.
  const castFix = alternatives.find(
    (a) =>
      a.stream.url &&
      a.stream.url !== url &&
      a.cached !== false &&
      !isMkv(a.stream.url, a.stream.behaviorHints?.filename) &&
      (languages?.length ? a.languages.some((l) => l !== "multi" && languages.includes(l)) : !a.languages.length),
  );
  const langOptions = languageOptions(alternatives);
  const qualities = qualityOptions(alternatives, url, languages, current?.language ?? "es-419");
  const lighter = lighterOption(qualities);
  const currentQuality = qualities.find((q) => q.current)?.quality;
  // Another ready stream with the same audio language and browser-friendly
  // audio: the one-click way out of the "no sound" warning.
  const sameLanguageFix = alternatives.find(
    (a) =>
      a.stream.url !== url &&
      a.cached !== false &&
      !a.audioRisk &&
      (languages?.length ? a.languages.some((l) => l !== "multi" && languages.includes(l)) : !a.languages.length),
  );
  // For "the browser can't play this format": same language, ready, and
  // nothing the browser struggles with (MKV, HEVC, HDR, AC3).
  const formatFix = alternatives.find(
    (a) =>
      a.stream.url !== url &&
      a.cached !== false &&
      !a.webRisk &&
      !a.audioRisk &&
      (languages?.length ? a.languages.some((l) => l !== "multi" && languages.includes(l)) : !a.languages.length),
  );
  // No picture → needs a browser-friendly file; no sound → friendly audio.
  const warningFix = warning?.kind === "video" ? formatFix : sameLanguageFix;
  const currentChoice: AudioChoice | undefined = languages?.length
    ? languages.find((l) => l !== "multi") ?? "original"
    : "original";
  // Subtitles follow the profile's subtitle language setting.
  const preferred = languageInfo(current?.subtitle_language ?? current?.language).subtitles;
  const subtitlesMode = current?.subtitles_mode ?? "auto";

  // HLS: by URL, or what the desktop app's analysis found (some addons'
  // links don't end in .m3u8).
  const isHlsSource = Boolean(
    srcUrl && (/\.m3u8(\?|$)/i.test(srcUrl) || (desk.server === false && /hls|applehttp/.test(desk.info?.container ?? ""))),
  );

  // --- video source (plain file, or HLS through hls.js where needed) ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    setHlsAudioTracks([]);
    setHlsAudioIndex(-1);
    setHlsLevels([]);
    setHlsLevel(-1);
    setHlsPlaying(-1);
    if (!srcUrl) return; // desktop app still analyzing the file
    if (!isHlsSource) {
      video.src = srcUrl;
      return;
    }
    let destroyed = false;
    let hls: { destroy: () => void } | undefined;
    import("hls.js").then(({ default: Hls }) => {
      if (destroyed) return;
      // Prefer hls.js (lets us pick the quality); native HLS (iPhone) adapts
      // by itself but can't be controlled.
      // iPhone/iPad: always the built-in player (sturdier there than hls.js
      // over ManagedMediaSource, and it handles the lock screen/AirPlay).
      if (!Hls.isSupported() || (mediaSupport().ios && mediaSupport().nativeHls)) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = srcUrl;
        else setFatal(t("Este navegador no soporta streams HLS."));
        return;
      }
      const instance = new Hls();
      hls = instance;
      hlsRef.current = instance;
      const readTracks = () => {
        setHlsAudioTracks(instance.audioTracks.map((item) => ({ name: item.name, lang: item.lang })));
        setHlsAudioIndex(instance.audioTrack);
      };
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        readTracks();
        setHlsLevels(instance.levels.map((l) => ({ height: l.height, bitrate: l.bitrate })));
      });
      instance.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setHlsPlaying(data.level));
      instance.on(Hls.Events.AUDIO_TRACKS_UPDATED, readTracks);
      instance.on(Hls.Events.AUDIO_TRACK_SWITCHED, () => setHlsAudioIndex(instance.audioTrack));
      instance.on(Hls.Events.ERROR, (_e, data) => {
        console.warn("[hls] error", data.type, data.details, data.fatal);
        if (data.fatal) setFatal(t("Se cortó la conexión con el stream."));
      });
      instance.loadSource(srcUrl);
      instance.attachMedia(video);
    });
    return () => {
      destroyed = true;
      hlsRef.current = null;
      hls?.destroy();
    };
  }, [srcUrl, isHlsSource]);

  function chooseHlsLevel(level: number) {
    if (hlsRef.current) hlsRef.current.currentLevel = level; // -1 = automatic
    setHlsLevel(level);
    setMenu(null);
    setSlowPrompt(false);
  }

  function selectHlsAudio(index: number) {
    if (hlsRef.current) hlsRef.current.audioTrack = index;
    setHlsAudioIndex(index);
    setMenu(null);
  }

  // --- subtitles: from the stream itself + every subtitles addon ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const extra: Extra = {};
      const hints = stream.behaviorHints;
      if (hints?.filename) extra.filename = hints.filename;
      if (hints?.videoSize) extra.videoSize = String(hints.videoSize);
      if (hints?.videoHash) extra.videoHash = hints.videoHash;
      const fromAddons = await getSubtitles(active, type, id, extra).catch(() => [] as Subtitle[]);
      const chosen = chooseSubtitles([...(stream.subtitles ?? []), ...fromAddons], preferred);
      const loaded = await Promise.all(
        chosen.map(async (s, i): Promise<Track | null> => {
          try {
            const vtt = await fetchSubtitleVtt(s.url);
            return { id: `${i}-${s.id}`, label: `${subtitleLabel(s.lang)} ${i + 1}`, srclang: s.lang, vtt };
          } catch {
            return null;
          }
        }),
      );
      if (!cancelled) {
        setTracks(loaded.filter((t): t is Track => t !== null));
        setLoadingSubs(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // preferred derives from the profile; stable for the life of this page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, type, id, stream]);

  // In the app we know the real audio track; elsewhere, the stream's tags.
  const audioInMyLanguage = desk.info
    ? isTrackInLanguage(desk.info.audio.find((a) => a.order === desk.audio), current?.language ?? "es-419")
    : dubbed;

  // Once subtitles load, turn on the first one in the profile's language —
  // unless the audio already is in that language or this profile turned
  // subtitles off last time. Only once: later additions (embedded
  // subtitles) don't override what the user picked.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (!tracks.length || autoPicked.current) return;
    if (desk.active && desk.status === "probing") return; // wait to know the audio
    autoPicked.current = true;
    const first = preferred.includes(tracks[0].srclang.toLowerCase()) ? 0 : -1;
    if (subtitlesMode === "off") return setActiveTrack(-1);
    if (subtitlesMode === "always") return setActiveTrack(first);
    // "auto": on when the audio isn't in my language, unless I turned them
    // off on this device last time.
    const pref = getSubsPref(current?.id);
    setActiveTrack(pref === "off" || (audioInMyLanguage && pref !== "on") ? -1 : first);
  }, [tracks, audioInMyLanguage, preferred, current?.id, desk.active, desk.status, subtitlesMode]);

  // Blob URLs for the <track>s, shifted when the desktop server streams from
  // a seek point (the element's clock restarts at 0 there).
  const trackSrcs = useMemo(
    () =>
      tracks.map((t) =>
        URL.createObjectURL(new Blob([desk.offset ? shiftVtt(t.vtt, -desk.offset) : t.vtt], { type: "text/vtt" })),
      ),
    [tracks, desk.offset],
  );
  useEffect(() => () => trackSrcs.forEach((u) => URL.revokeObjectURL(u)), [trackSrcs]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    Array.from(video.textTracks).forEach((item, i) => {
      item.mode = i === activeTrack ? "showing" : "disabled";
    });
  }, [activeTrack, trackSrcs]);

  // Subtitles inside the file (desktop app). Extracting them reads the whole
  // file, so only on request.
  const [embeddedLoading, setEmbeddedLoading] = useState<number | null>(null);
  const embeddedSubs = (desk.info?.subtitles ?? []).filter((s) => s.text && !tracks.some((item) => item.id === `emb-${s.order}`));
  async function loadEmbedded(order: number) {
    const sub = desk.info?.subtitles.find((s) => s.order === order);
    if (!sub || embeddedLoading !== null) return;
    setEmbeddedLoading(order);
    try {
      const vtt = await fetchSubtitleVtt(embeddedSubtitleUrl(url, proxyHeaders, order), 10 * 60 * 1000);
      setTracks((prev) => {
        const next = [...prev, { id: `emb-${order}`, label: subtitleTrackLabel(sub), srclang: sub.language ?? "und", vtt }];
        setActiveTrack(next.length - 1);
        return next;
      });
      setSubsPref(current?.id, "on");
      setMenu(null);
    } catch (err) {
      console.warn("[desktop] embedded subtitle failed", err);
    } finally {
      setEmbeddedLoading(null);
    }
  }

  function chooseTrack(i: number) {
    setActiveTrack(i);
    setSubsPref(current?.id, i < 0 ? "off" : "on");
    setMenu(null);
  }

  /** Same title, another stream in the chosen language, same minute. */
  function switchTo(alt: AltStream, opts: { castOnStart?: boolean } = {}) {
    setMenu(null);
    if (alt.stream.url === url) return;
    const next: PlayerState = {
      ...state,
      stream: alt.stream,
      languages: alt.languages,
      dubbed: isDubbedFor(alt.languages, current?.language ?? "es-419") && !isMultiAudio(alt.languages),
      startAt: videoRef.current?.currentTime ?? 0,
      castOnStart: opts.castOnStart ?? false,
      resumed: false,
    };
    navigate(playerPath(type, id), { replace: true, state: next });
  }

  function chooseAudioTrack(index: number) {
    const list = (videoRef.current as (HTMLVideoElement & { audioTracks?: AudioTrackList }) | null)?.audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) list[i].enabled = i === index;
    setAudioTracks(Array.from({ length: list.length }, (_, i) => ({ ...list[i], enabled: i === index })));
    setMenu(null);
  }

  // --- detect what the browser can't decode ---
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let checked = false;
    // Seconds actually played, not the position: after a language switch we
    // jump straight to minute N and the decoder needs a moment to catch up.
    let played = 0;
    let last = video.currentTime;
    const shown = () => video.currentTime + (deskRef.current.server ? deskRef.current.offset : 0);
    const onError = () => {
      const d = deskRef.current;
      // App: the original didn't play → go through the local server.
      if (d.active && d.status === "ready" && !d.server) {
        d.forceServer(video.currentTime);
        return;
      }
      // App, already through the local server with the video copied as-is:
      // the built-in player can't decode it (HEVC 10-bit/HDR, old codecs).
      // Re-encode it with the Mac's hardware encoder, same minute.
      if (d.active && d.server && d.videoMode !== "h264") {
        console.info("[desktop] video not decodable, re-encoding to H.264");
        d.reencodeVideo(shown());
        return;
      }
      const code = video.error?.code;
      setFatal(
        code === 4
          ? mediaSupport().ios
            ? t("El iPhone no puede reproducir este formato (suele pasar con MKV). Prueba un stream MP4 o HLS.")
            : t("El navegador no puede reproducir este formato (suele pasar con MKV, HEVC o HDR).")
          : t("No se pudo cargar el video. Puede que el enlace haya expirado o que tu debrid aún lo esté descargando."),
      );
    };
    const onTime = () => {
      const delta = video.currentTime - last;
      last = video.currentTime;
      if (delta > 0 && delta < 1.5) played += delta; // ignore seeks
      if (checked || played < 4) return;
      checked = true;
      const d = deskRef.current;
      if (d.active && d.status === "ready") {
        // App: audio always arrives as AAC; a picture that doesn't decode
        // gets re-encoded by the Mac's hardware encoder.
        if (video.videoWidth === 0 && d.videoMode !== "h264") {
          checked = false;
          played = 0;
          d.reencodeVideo(shown());
        }
        return;
      }
      const decodedAudio = (video as HTMLVideoElement & { webkitAudioDecodedByteCount?: number }).webkitAudioDecodedByteCount;
      // WebKit counts decoded frames: 0 after seconds of playback = black
      // screen with sound (iOS reports a size even when it can't decode).
      const decodedFrames = (video as HTMLVideoElement & { webkitDecodedFrameCount?: number }).webkitDecodedFrameCount;
      if (video.videoWidth === 0 || decodedFrames === 0) {
        video.pause();
        setWarning({
          kind: "video",
          title: t("Este video no se ve en el navegador"),
          detail: mediaSupport().ios
            ? t("Hay sonido pero no imagen: el iPhone no puede mostrar el video de este archivo (suele pasar con algunos HEVC o Dolby Vision). Prueba otra versión.")
            : t("Hay sonido pero no imagen: el archivo probablemente está en HEVC. En la app de Android sí se verá."),
        });
      } else if (decodedAudio === 0 && !video.muted) {
        video.pause();
        setWarning({
          kind: "audio",
          title: t("Este video no tiene sonido en el navegador"),
          detail: t("Su audio está en un formato que el navegador no reproduce (suele ser AC3 o DTS). En la app de Android sí sonará."),
        });
      }
    };
    const onMeta = () => {
      // No movie or episode is under 90 s; Torrentio's placeholder is 30 s.
      // (Not for Real-Debrid live transcodes, whose duration can look odd.)
      if (!deskRef.current.active && Number.isFinite(video.duration) && video.duration > 0 && video.duration < 90) {
        video.pause();
        setDownloading(true);
        return;
      }
      const at = resumeAt.current;
      resumeAt.current = undefined;
      if (at && (!Number.isFinite(video.duration) || at < video.duration)) video.currentTime = at;
      const list = (video as HTMLVideoElement & { audioTracks?: AudioTrackList }).audioTracks;
      if (list && list.length > 1 && !deskRef.current.active) {
        // WebKit (iPhone, Safari) may enable EVERY track of a multi-audio
        // MP4 and play them on top of each other. Keep exactly one: the
        // profile's language if the file has it (Latino first for es-419).
        const lang = profileLangRef.current;
        const indices = Array.from({ length: list.length }, (_, i) => i);
        const inLang = indices.filter((i) =>
          isTrackInLanguage({ language: list[i].language, title: list[i].label } as Parameters<typeof isTrackInLanguage>[0], lang),
        );
        const latino = lang === "es-419" ? inLang.find((i) => /lat|419|m[eé]x/i.test(`${list[i].label} ${list[i].language}`)) : undefined;
        const enabled = indices.filter((i) => list[i].enabled);
        const keep = latino ?? inLang[0] ?? enabled[0] ?? 0;
        if (enabled.length !== 1 || enabled[0] !== keep) {
          for (const i of indices) list[i].enabled = i === keep;
        }
        setAudioTracks(
          Array.from({ length: list.length }, (_, i) => ({
            id: list[i].id,
            label: list[i].label,
            language: list[i].language,
            enabled: list[i].enabled,
          })),
        );
      }
    };
    video.addEventListener("error", onError);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("loadedmetadata", onMeta);
    return () => {
      video.removeEventListener("error", onError);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("loadedmetadata", onMeta);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- progress: Continuar viendo / history / watched (synced per profile) ---
  const remote = casting.remote;
  const progressSaver = useProgressSaver({
    videoId: id,
    ctx: state.progress,
    position: remote ? remote.currentTime : playback.currentTime,
    duration: remote ? remote.duration : playback.duration,
    paused: remote ? remote.paused : playback.paused,
    enabled: !downloading && !fatal && desk.status !== "probing" && desk.status !== "placeholder",
  });

  // "Continuando desde 23:10 · Empezar de nuevo" for a few seconds.
  const [resumeNote, setResumeNote] = useState(Boolean(state.resumed && startAt));
  useEffect(() => {
    if (!resumeNote) return;
    const t = window.setTimeout(() => setResumeNote(false), 9000);
    return () => window.clearTimeout(t);
  }, [resumeNote]);

  // --- slow connection: offer a lighter version ---
  // Counts stalls while playing (not the first load, not right after a seek
  // or a source change); 3 within a minute, or one longer than 8 s → offer.
  const [slowPrompt, setSlowPrompt] = useState(false);
  const slowDismissed = useRef(false);
  const lighterRef = useRef(lighter);
  const hlsLevelsRef = useRef(hlsLevels);
  useEffect(() => {
    hlsLevelsRef.current = hlsLevels;
  });
  useEffect(() => {
    lighterRef.current = lighter;
  });
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let quietUntil = Date.now() + 15_000; // first load
    let stalls: number[] = [];
    let longTimer: number | undefined;
    const offer = () => {
      if (slowDismissed.current || video.paused) return;
      if (!lighterRef.current && hlsLevelsRef.current.length < 2) return;
      setSlowPrompt(true);
      setChromeVisible(true);
    };
    const onWaiting = () => {
      if (Date.now() < quietUntil || video.paused) return;
      const now = Date.now();
      stalls = [...stalls.filter((item) => now - item < 60_000), now];
      if (stalls.length >= 3) offer();
      window.clearTimeout(longTimer);
      longTimer = window.setTimeout(offer, 8_000);
    };
    const onPlaying = () => window.clearTimeout(longTimer);
    const onSeekOrLoad = () => {
      quietUntil = Date.now() + 6_000;
      window.clearTimeout(longTimer);
    };
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("seeking", onSeekOrLoad);
    video.addEventListener("loadstart", onSeekOrLoad);
    return () => {
      window.clearTimeout(longTimer);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("seeking", onSeekOrLoad);
      video.removeEventListener("loadstart", onSeekOrLoad);
    };
  }, []);

  // --- overlay that hides while watching ---
  const poke = useCallback(() => {
    setChromeVisible(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (!videoRef.current?.paused) setChromeVisible(false);
    }, 3000);
  }, []);
  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // --- custom controls (native ones can't host our buttons, and their
  // fullscreen would hide our menus and warnings) ---
  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const root = rootRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (root?.requestFullscreen) {
      root.requestFullscreen().catch(() => {});
    } else {
      video?.webkitEnterFullscreen?.(); // iPhone: only the video can go fullscreen
    }
  }, []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }, []);

  function seek(seconds: number) {
    if (desk.server) {
      desk.seekTo(seconds);
      return;
    }
    const video = videoRef.current;
    if (video) video.currentTime = Math.max(0, Math.min(video.duration || Infinity, seconds));
  }
  const seekByRef = useRef((delta: number) => seek(playback.currentTime + delta));
  useEffect(() => {
    seekByRef.current = (delta: number) => seek(playback.currentTime + delta);
  });

  // --- keyboard / TV remote ---
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const video = videoRef.current;
      const tag = (e.target as HTMLElement).tagName;
      if (!video || tag === "INPUT") return;
      // Space/Enter on a focused button presses that button (warning, menus).
      if (tag === "BUTTON" && (e.key === " " || e.key === "Enter")) return;
      poke();
      if (e.key === " " || e.key === "k" || e.key === "MediaPlayPause") {
        e.preventDefault();
        if (video.paused) video.play();
        else video.pause();
      } else if (e.key === "ArrowRight" && e.target === document.body) {
        seekByRef.current(10);
      } else if (e.key === "ArrowLeft" && e.target === document.body) {
        seekByRef.current(-10);
      } else if (e.key === "f") {
        toggleFullscreen();
      } else if (e.key === "Backspace" || e.key === "BrowserBack") {
        navigate(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, poke, toggleFullscreen]);

  function retry() {
    const video = videoRef.current;
    if (!video) return;
    setDownloading(false);
    setFatal(null);
    if (desk.active) {
      desk.retry(); // analyze again: the debrid may have the file now
      return;
    }
    // Ask the addon again: once the debrid has the file it redirects to it.
    video.src = url;
    video.load();
    video.play().catch(() => {});
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // ignore
    }
  }

  return (
    <div
      ref={rootRef}
      className={`fixed inset-0 z-50 bg-black text-white ${chromeVisible || menu ? "" : "cursor-none"}`}
      onMouseMove={poke}
      onTouchStart={poke}
    >
      <video
        ref={videoRef}
        className="size-full"
        autoPlay
        playsInline
        x-webkit-airplay="allow"
        onClick={() => {
          if (menu) setMenu(null);
          else togglePlay();
        }}
        onDoubleClick={toggleFullscreen}
        onPause={() => setChromeVisible(true)}
        onPlay={poke}
        onEnded={() => progressSaver.saveNow()}
      >
        {tracks.map((item, i) => (
          <track key={`${item.id}@${desk.offset}`} kind="subtitles" label={item.label} srcLang={item.srclang} src={trackSrcs[i]} />
        ))}
      </video>

      {(playback.waiting || desk.status === "probing") && !downloading && !fatal && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <Loader2 className="size-12 animate-spin text-white/80" />
        </div>
      )}

      <div
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-center gap-3 bg-gradient-to-b from-black/80 to-transparent p-4 transition-opacity duration-300 ${chromeVisible || menu ? "opacity-100" : "opacity-0"}`}
      >
        <Button
          variant="ghost"
          size="icon"
          className="pointer-events-auto text-white hover:bg-white/15"
          onClick={() => navigate(-1)}
          aria-label={t("Volver")}
        >
          <ArrowLeft />
        </Button>
        <p className="min-w-0 flex-1 truncate font-medium">{title}</p>
      </div>

      {resumeNote && startAt ? (
        <div className="absolute left-1/2 top-20 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full bg-black/80 py-2 pl-4 pr-2 text-sm shadow-lg">
          <span>{t("Continuando desde {time}", { time: formatTime(startAt) })}</span>
          <button
            className="rounded-full bg-white/15 px-3 py-1 font-medium hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={() => {
              setResumeNote(false);
              seek(0);
            }}
          >
            {t("Empezar de nuevo")}
          </button>
        </div>
      ) : null}

      <ControlBar
        playback={playback}
        visible={chromeVisible || Boolean(menu)}
        onTogglePlay={togglePlay}
        onSeek={seek}
        onSkip={(d) => seek(playback.currentTime + d)}
        onVolume={(v) => {
          const video = videoRef.current;
          if (!video) return;
          video.volume = v;
          video.muted = v === 0;
        }}
        onToggleMute={() => {
          const video = videoRef.current;
          if (video) video.muted = !video.muted;
        }}
        right={
          <>
            {(alternatives.length > 0 || hlsLevels.length > 1) && (
              <BarButton
                label={t("Calidad")}
                active={menu === "quality"}
                onClick={() => setMenu((m) => (m === "quality" ? null : "quality"))}
              >
                <Gauge />
                <span className="hidden text-sm sm:inline">
                  {hlsLevels.length > 1
                    ? hlsLevel === -1
                      ? `Auto${hlsLevels[hlsPlaying]?.height ? ` (${hlsLevels[hlsPlaying].height}p)` : ""}`
                      : `${hlsLevels[hlsLevel]?.height ?? "?"}p`
                    : (currentQuality ?? t("Calidad"))}
                </span>
              </BarButton>
            )}
            {(langOptions.length > 1 || audioTracks.length > 1 || hlsAudioTracks.length > 1 || isMultiAudio(languages ?? []) || (desk.info?.audio.length ?? 0) > 1) && (
              <BarButton
                label={t("Idioma del audio")}
                active={menu === "lang"}
                onClick={() => setMenu((m) => (m === "lang" ? null : "lang"))}
              >
                <Languages />
                <span className="hidden text-sm sm:inline">
                  {(desk.info?.audio.length ?? 0) > 1
                    ? subtitleLabel(desk.info!.audio.find((a) => a.order === desk.audio)?.language ?? "") || "Audio"
                    : audioTracks.length > 1
                    ? audioTracks.find((item) => item.enabled)?.label || "Audio"
                    : isMultiAudio(languages ?? [])
                      ? t("Multi audio")
                      : currentChoice
                        ? choiceLabel(currentChoice)
                        : t("Idioma")}
                </span>
              </BarButton>
            )}
            {loadingSubs ? (
              <BarButton label={t("Buscando subtítulos…")} onClick={() => {}}>
                <Loader2 className="animate-spin" />
              </BarButton>
            ) : tracks.length > 0 || embeddedSubs.length > 0 ? (
              <BarButton
                label={t("Subtítulos")}
                active={menu === "subs"}
                onClick={() => setMenu((m) => (m === "subs" ? null : "subs"))}
              >
                <Subtitles className={activeTrack >= 0 ? "" : "opacity-60"} />
                <span className="hidden text-sm sm:inline">{activeTrack >= 0 && tracks[activeTrack] ? tracks[activeTrack].label: t("No")}</span>
              </BarButton>
            ) : null}
            <BarButton
              label={t("Transmitir a la TV")}
              active={menu === "cast"}
              onClick={() => {
                if (casting.kind === "desktop") {
                  casting.refreshDevices();
                  setMenu((m) => (m === "cast" ? null : "cast"));
                } else if (casting.kind) {
                  setMenu(null);
                  casting.start();
                } else {
                  setMenu((m) => (m === "cast" ? null : "cast"));
                }
              }}
            >
              {casting.kind === "airplay" ? <Airplay /> : <Cast />}
            </BarButton>
            <BarButton label={fullscreen ? t("Salir de pantalla completa") : t("Pantalla completa")} onClick={toggleFullscreen}>
              {fullscreen ? <Minimize /> : <Maximize />}
            </BarButton>
          </>
        }
      />

      {menu === "cast" &&
        (casting.kind === "desktop" ? (
          <CastDevicePicker
            devices={casting.devices}
            onPick={(id) => {
              setMenu(null);
              casting.castTo(id);
            }}
            onRefresh={() => casting.refreshDevices()}
            onClose={() => setMenu(null)}
          />
        ) : (
          <CastHelp onClose={() => setMenu(null)} diagnostics={casting.diagnostics} />
        ))}

      {casting.error && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-white/15 bg-neutral-900/95 p-6 text-center shadow-2xl">
            <div className="flex size-14 items-center justify-center rounded-full bg-yellow-400/15">
              <Cast className="size-7 text-yellow-400" />
            </div>
            <p className="text-lg font-semibold">{casting.error.message}</p>
            <div className="flex w-full flex-col gap-2">
              {casting.error.stage === "load" && castFix && (
                <Button
                  size="lg"
                  className="w-full"
                  autoFocus
                  onClick={() => {
                    casting.clearError();
                    switchTo(castFix, { castOnStart: true });
                  }}
                >
                  <Cast />
                  {t("Transmitir versión MP4")}{castFix.quality ? ` (${castFix.quality})` : ""}
                </Button>
              )}
              <Button
                size="lg"
                variant={casting.error.stage === "load" && castFix ? "outline" : "default"}
                className={`w-full ${casting.error.stage === "load" && castFix ? "border-white/30 text-white hover:bg-white/10" : ""}`}
                autoFocus={!(casting.error.stage === "load" && castFix)}
                onClick={() => {
                  casting.clearError();
                  casting.start();
                }}
              >
                <RotateCw />
                {t("Reintentar")}
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="w-full text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  casting.clearError();
                  videoRef.current?.play().catch(() => {});
                }}
              >
                <Play />
                {t("Seguir viendo aquí")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {casting.remote && (
        <CastingOverlay
          remote={casting.remote}
          title={title}
          onTogglePause={casting.togglePause}
          onSeekBy={casting.seekBy}
          onSeekTo={casting.seekTo}
          onStop={casting.stop}
          note={
            casting.kind === "desktop"
              ? t("Los subtítulos se envían a Chromecast; los Smart TV (DLNA) no los muestran.")
              : t("Por ahora los subtítulos no se envían a la TV.")
          }
        />
      )}

      {menu === "quality" && (
        <div className="absolute bottom-24 right-4 z-20 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-white/15 bg-black/90 py-1 text-sm shadow-xl">
          {hlsLevels.length > 1 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-white/50">{t("Calidad de este stream")}</p>
              <MenuItem checked={hlsLevel === -1} onClick={() => chooseHlsLevel(-1)} hint={t("según tu internet")}>
                {t("Automática")}
              </MenuItem>
              {hlsLevels
                .map((l, i) => ({ ...l, i }))
                .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate)
                .map((l) => (
                  <MenuItem
                    key={l.i}
                    checked={hlsLevel === l.i}
                    onClick={() => chooseHlsLevel(l.i)}
                    hint={l.bitrate ? `${(l.bitrate / 1_000_000).toFixed(1)} Mbps` : undefined}
                  >
                    {l.height ? `${l.height}p` : `Nivel ${l.i + 1}`}
                  </MenuItem>
                ))}
            </>
          )}
          <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-white/50">
            {hlsLevels.length > 1 ? t("Otras versiones") : t("Calidad")}
          </p>
          {qualities.map((q) => (
            <MenuItem
              key={q.alt.stream.url}
              checked={q.current}
              onClick={() => {
                setMenu(null);
                if (!q.current) switchTo(q.alt);
              }}
              hint={q.alt.size ?? undefined}
            >
              {q.quality ?? t("Sin indicar")}
            </MenuItem>
          ))}
          <p className="px-3 py-2 text-xs text-white/50">
            {qualities.length > 1
              ? t("Menor calidad = archivo más liviano, ideal si tu internet va lento. Sigue desde el mismo minuto.")
              : t("No hay otras calidades listas con este mismo audio. Puedes elegir otro stream desde la lista.")}
          </p>
        </div>
      )}

      {slowPrompt && (lighter || hlsLevels.length > 1) && !menu && !fatal && !casting.remote && (
        <div className="absolute bottom-24 left-1/2 z-20 flex w-[min(32rem,calc(100%-2rem))] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/15 bg-neutral-900/95 p-3 shadow-2xl">
          <Wifi className="size-5 shrink-0 text-yellow-400" />
          <p className="flex-1 text-sm">
            {hlsLevels.length > 1 ? (
              <>{t("Tu conexión va lenta. ¿Bajar a {quality}?", { quality: `${Math.min(...hlsLevels.map((l) => l.height || Infinity))}p` })}</>
            ) : (
              <>
                {t("Tu conexión va lenta. ¿Bajar a {quality}?", {
                  quality: `${lighter?.quality ?? t("una versión más liviana")}${lighter?.alt.size ? ` (${lighter.alt.size})` : ""}`,
                })}
              </>
            )}
          </p>
          <Button
            size="sm"
            autoFocus
            onClick={() => {
              setSlowPrompt(false);
              if (hlsLevels.length > 1) {
                // lowest level
                const lowest = hlsLevels.reduce((best, l, i) => (l.height < hlsLevels[best].height ? i : best), 0);
                chooseHlsLevel(lowest);
              } else if (lighter) {
                switchTo(lighter.alt);
              }
            }}
          >
            {t("Bajar calidad")}
          </Button>
          <button
            onClick={() => {
              setSlowPrompt(false);
              slowDismissed.current = true;
            }}
            aria-label={t("No, gracias")}
            title={t("No, gracias")}
            className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="size-4" />
          </button>
        </div>
      )}

      {menu === "lang" && (
        <div className="absolute bottom-24 right-4 z-20 max-h-[60vh] w-72 overflow-y-auto rounded-lg border border-white/15 bg-black/90 py-1 text-sm shadow-xl">
          {desk.info && desk.info.audio.length > 1 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-white/50">{t("Audio de este archivo")}</p>
              {desk.info.audio.map((item) => (
                <MenuItem
                  key={item.order}
                  checked={item.order === desk.audio}
                  onClick={() => {
                    setMenu(null);
                    if (item.order !== desk.audio) desk.selectAudio(item.order, playback.currentTime);
                  }}
                >
                  {audioTrackLabel(item)}
                </MenuItem>
              ))}
            </>
          )}
          {hlsAudioTracks.length > 1 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-white/50">{t("Audio de este stream")}</p>
              {hlsAudioTracks.map((item, i) => (
                <MenuItem key={i} checked={i === hlsAudioIndex} onClick={() => selectHlsAudio(i)}>
                  {item.name || (item.lang ? subtitleLabel(item.lang) : t("Pista {n}", { n: i + 1 }))}
                </MenuItem>
              ))}
            </>
          )}
          {audioTracks.length > 1 && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-white/50">{t("Audio de este archivo")}</p>
              {audioTracks.map((item, i) => (
                <MenuItem key={item.id || i} checked={item.enabled} onClick={() => chooseAudioTrack(i)}>
                  {item.label || subtitleLabel(item.language) || t("Pista {n}", { n: i + 1 })}
                </MenuItem>
              ))}
            </>
          )}
          {(langOptions.length > 1 || isMultiAudio(languages ?? [])) && (
            <>
              <p className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-white/50">{t("Cambiar a otra versión")}</p>
              {langOptions.map(({ langs, alt, multi }) => (
                <MenuItem
                  key={alt.stream.url}
                  checked={alt.stream.url === url}
                  onClick={() => switchTo(alt)}
                  hint={[alt.quality, alt.size].filter(Boolean).join(" · ")}
                >
                  {multi ? `${langs.map((l) => choiceLabel(l)).join(", ")} (${t("varios idiomas")})` : choiceLabel(langs[0])}
                </MenuItem>
              ))}
              {isMultiAudio(languages ?? []) && !desk.info && (
                <p className="px-3 pt-2 text-xs text-yellow-300/90">
                  {t("Este archivo trae varios idiomas y el navegador reproduce el predeterminado, que puede ser el original.")}
                  {t("Para asegurar el idioma, elige una versión de un solo idioma.")}
                </p>
              )}
              <p className="px-3 py-2 text-xs text-white/50">{t("Cambia de archivo y sigue desde el mismo minuto.")}</p>
            </>
          )}
        </div>
      )}

      {menu === "subs" && (
        // Inline (no portal) so it also shows in fullscreen.
        <div className="absolute bottom-24 right-4 z-20 max-h-[60vh] w-64 overflow-y-auto rounded-lg border border-white/15 bg-black/90 py-1 text-sm shadow-xl">
          {[{ id: "off", label: t("Desactivados") }, ...tracks].map((item, i) => {
            const index = i - 1;
            return (
              <button
                key={item.id}
                onClick={() => chooseTrack(index)}
                className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
                autoFocus={index === activeTrack}
              >
                <Check className={`size-4 shrink-0 ${index === activeTrack ? "opacity-100" : "opacity-0"}`} />
                {item.label}
              </button>
            );
          })}
          {embeddedSubs.map((s) => (
            <button
              key={`emb-${s.order}`}
              onClick={() => loadEmbedded(s.order)}
              disabled={embeddedLoading !== null}
              className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none disabled:opacity-60"
            >
              {embeddedLoading === s.order ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <span className="size-4 shrink-0" />}
              <span className="flex-1">
                {subtitleTrackLabel(s)}
                {embeddedLoading === s.order && <span className="block text-xs text-white/50">{t("Extrayendo del archivo… puede tardar un poco")}</span>}
              </span>
            </button>
          ))}
        </div>
      )}

      {warning && !fatal && !casting.remote && (
        // Centered over the video and paused, so it can't be missed. Big
        // buttons with focus on the best option, for mouse and TV remote.
        <div className="absolute inset-0 flex items-center justify-center bg-black/75 p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-white/15 bg-neutral-900/95 p-6 text-center shadow-2xl">
            <div className="flex size-14 items-center justify-center rounded-full bg-yellow-400/15">
              {warning.kind === "audio" ? (
                <VolumeX className="size-7 text-yellow-400" />
              ) : (
                <AlertTriangle className="size-7 text-yellow-400" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xl font-semibold">{warning.title}</p>
              <p className="text-sm text-white/70">{warning.detail}</p>
            </div>
            <div className="flex w-full flex-col gap-2">
              {warningFix && (
                <Button size="lg" className="w-full" autoFocus onClick={() => switchTo(warningFix)}>
                  <RotateCw />
                  {t("Probar otra versión")}
                  {currentChoice && currentChoice !== "original" ? ` ${t("en {lang}", { lang: choiceLabel(currentChoice).toLowerCase() })}` : ""}
                </Button>
              )}
              <Button
                size="lg"
                variant={warningFix ? "outline" : "default"}
                className={`w-full ${warningFix ? "border-white/30 text-white hover:bg-white/10" : ""}`}
                autoFocus={!warningFix}
                onClick={() => navigate(-1)}
              >
                <ListVideo />
                {t("Elegir otro stream")}
              </Button>
              <Button
                size="lg"
                variant="ghost"
                className="w-full text-white/70 hover:bg-white/10 hover:text-white"
                onClick={() => {
                  setWarning(null);
                  videoRef.current?.play().catch(() => {});
                }}
              >
                <Play />
                {t("Seguir viendo así")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {downloading && !fatal && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/90 p-6">
          <div className="flex max-w-md flex-col items-center gap-4 text-center">
            <Download className="size-10 text-primary" />
            <p className="text-lg font-semibold">{t("Real-Debrid está descargando este archivo")}</p>
            <p className="text-sm text-white/70">
              {t("No estaba en su caché, así que ya pidió descargarlo. Puede tardar desde unos minutos hasta horas si tiene pocas fuentes. Puedes volver más tarde, o elegir ahora un stream marcado como ⚡ Listo, que empieza al instante.")}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => navigate(-1)}>{t("Elegir uno listo")}</Button>
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={retry}>
                <RotateCw />
                {t("Reintentar")}
              </Button>
            </div>
          </div>
        </div>
      )}

      {fatal && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/85 p-6">
          <div className="flex w-full max-w-md flex-col items-center gap-5 rounded-2xl border border-white/15 bg-neutral-900/95 p-6 text-center shadow-2xl">
            <div className="flex size-14 items-center justify-center rounded-full bg-yellow-400/15">
              <AlertTriangle className="size-7 text-yellow-400" />
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xl font-semibold">{fatal}</p>
              <p className="text-sm text-white/70">
                {desk.active
                  ? t("Ni convirtiéndolo se pudo reproducir este archivo. Prueba con otra versión.")
                  : formatFix
                    ? t("Hay otra versión en tu idioma que el navegador sí puede reproducir.")
                    : t("Prueba otro stream (MP4 1080p sin HEVC suele funcionar), o usa la app de Mac, que reproduce estos formatos.")}
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              {formatFix && (
                <Button
                  size="lg"
                  className="w-full"
                  autoFocus
                  onClick={() => {
                    setFatal(null);
                    switchTo(formatFix);
                  }}
                >
                  <RotateCw />
                  {t("Probar versión compatible")}
                  {[formatFix.quality, formatFix.size].filter(Boolean).length
                    ? ` (${[formatFix.quality, formatFix.size].filter(Boolean).join(" · ")})`
                    : ""}
                </Button>
              )}
              <Button
                size="lg"
                variant={formatFix ? "outline" : "default"}
                className={`w-full ${formatFix ? "border-white/30 text-white hover:bg-white/10" : ""}`}
                autoFocus={!formatFix}
                onClick={() => navigate(-1)}
              >
                <ListVideo />
                {t("Elegir otro stream")}
              </Button>
              <Button size="lg" variant="ghost" className="w-full text-white/70 hover:bg-white/10 hover:text-white" onClick={copyLink}>
                <Copy />
                {copied ? t("¡Enlace copiado!") : t("Copiar enlace (para VLC)")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  checked,
  onClick,
  hint,
  children,
}: {
  checked: boolean;
  onClick: () => void;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      autoFocus={checked}
      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-white/10 focus-visible:bg-white/10 focus-visible:outline-none"
    >
      <Check className={`size-4 shrink-0 ${checked ? "opacity-100" : "opacity-0"}`} />
      <span className="flex-1">{children}</span>
      {hint && <span className="text-xs text-white/50">{hint}</span>}
    </button>
  );
}
