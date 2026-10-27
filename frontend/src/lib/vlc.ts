/**
 * "Abrir en VLC" (iPhone/iPad): hands the stream URL to the VLC app, which
 * plays what Safari can't (MKV, HEVC, AC3/DTS, audio track choice, plain
 * http and .ts channels). AetherIO doesn't learn the position from VLC, so
 * there's no resume for those sessions.
 */
import { mediaSupport } from "@/lib/browser";

export const VLC_APP_STORE = "https://apps.apple.com/app/vlc-media-player/id650377962";

/** Only offered on iPhone/iPad (where it's needed and VLC handles the link). */
export function vlcAvailable() {
  return mediaSupport().ios;
}

export function vlcUrl(streamUrl: string) {
  return `vlc-x-callback://x-callback-url/stream?url=${encodeURIComponent(streamUrl)}`;
}

/** Opens VLC; resolves false when nothing happened after a moment (VLC
 * probably isn't installed), so the caller can point to the App Store. */
export function openInVlc(streamUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    let left = false;
    const onHide = () => {
      if (document.visibilityState === "hidden") left = true;
    };
    document.addEventListener("visibilitychange", onHide);
    window.setTimeout(() => {
      document.removeEventListener("visibilitychange", onHide);
      resolve(left);
    }, 2000);
    window.location.href = vlcUrl(streamUrl);
  });
}
