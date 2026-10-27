import axios from "axios";
import { t } from "@/i18n";

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const api = axios.create({
  baseURL: API_BASE_URL,
  // Without a timeout a hung request leaves the UI on a spinner forever.
  // Installing an addon waits on a third-party server, so give it room.
  timeout: 20000,
});

const TOKEN_KEY = "ap_token";
const PROFILE_KEY = "ap_profile";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
}

/** Profile chosen on this device (like Netflix, each device remembers its own). */
export function getProfileId(): number | null {
  try {
    const v = Number(localStorage.getItem(PROFILE_KEY));
    return Number.isInteger(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setProfileId(id: number | null): void {
  try {
    if (id === null) localStorage.removeItem(PROFILE_KEY);
    else localStorage.setItem(PROFILE_KEY, String(id));
  } catch {
    // Best-effort: the picker just shows again next time.
  }
}

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const profileId = getProfileId();
  if (profileId) {
    config.headers["X-Profile-Id"] = String(profileId);
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  },
);

/** The backend's `detail` message (user-facing, written in Spanish),
 * translated to the app's language. */
export function getErrorDetail(err: unknown): string | undefined {
  if (err && typeof err === "object" && "response" in err) {
    const detail = (err as { response?: { data?: { detail?: unknown } } }).response?.data?.detail;
    if (typeof detail === "string") return t(detail);
  }
  return undefined;
}
