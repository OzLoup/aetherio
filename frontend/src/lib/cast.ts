/** Loads Google's Cast sender SDK once. Resolves false where Cast isn't
 * available (Safari, Firefox, and sometimes non-Chrome Chromium browsers). */
let castReady: Promise<boolean> | null = null;

/** Why Cast is (un)available — shown in the cast help for troubleshooting. */
export const castDiagnostics: { sdk: "loading" | "available" | "unavailable" | "blocked" | "timeout"; reason?: string } = {
  sdk: "loading",
};

const SDK_URL = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";

// Kept on window so a dev hot-reload of this module doesn't inject the SDK
// twice (it throws "google-cast-button has already been used").
type CastWindow = Window & { __apCastReady?: Promise<boolean> };

export function loadCastSdk(timeoutMs = 8000): Promise<boolean> {
  const w = window as CastWindow;
  castReady ??= w.__apCastReady ?? null;
  if (castReady) return castReady;
  castReady = new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => {
      castDiagnostics.sdk = "timeout";
      resolve(false);
    }, timeoutMs);
    window.__onGCastApiAvailable = (available, reason) => {
      window.clearTimeout(timer);
      castDiagnostics.sdk = available ? "available" : "unavailable";
      castDiagnostics.reason = reason;
      console.info("[cast] Google Cast available:", available, reason ?? "");
      if (available) {
        cast.framework.CastContext.getInstance().setOptions({
          // Google's stock receiver: plays a URL on the TV, no app to publish.
          receiverApplicationId: chrome.cast.media.DEFAULT_MEDIA_RECEIVER_APP_ID,
          autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
      }
      resolve(available);
    };
    const script = document.createElement("script");
    script.src = SDK_URL;
    script.async = true;
    script.onerror = () => {
      window.clearTimeout(timer);
      // Usually a content/tracking blocker stopping gstatic.com.
      castDiagnostics.sdk = "blocked";
      resolve(false);
    };
    document.head.appendChild(script);
  });
  w.__apCastReady = castReady;
  return castReady;
}

/** MIME type the receiver needs, guessed from the file name / URL. */
export function guessContentType(url: string, filename?: string) {
  const name = `${filename ?? ""} ${url}`.toLowerCase();
  if (/\.m3u8\b/.test(name)) return "application/x-mpegurl";
  if (/\.mkv\b/.test(name)) return "video/x-matroska";
  if (/\.webm\b/.test(name)) return "video/webm";
  return "video/mp4";
}

export function isMkv(url: string, filename?: string) {
  return guessContentType(url, filename) === "video/x-matroska";
}
