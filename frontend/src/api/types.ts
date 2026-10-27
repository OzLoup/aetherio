import type { LanguageCode } from "@/lib/languages";
import type { Manifest } from "@/lib/stremio";

export interface User {
  id: number;
  email: string;
  name?: string | null;
  has_password?: boolean;
  google_linked?: boolean;
  /** Parental control PIN set for the account. */
  has_pin?: boolean;
}

export const PROFILE_COLORS = [
  "series-1",
  "series-2",
  "series-3",
  "series-4",
  "series-5",
  "series-6",
  "series-7",
  "series-8",
] as const;

export type ProfileColor = (typeof PROFILE_COLORS)[number];

export interface Profile {
  id: number;
  name: string;
  color: ProfileColor;
  /** Preferred audio language, see lib/languages.ts. */
  language: LanguageCode;
  /** Language of the app itself. */
  ui_language: "es" | "en";
  subtitle_language: LanguageCode;
  /** auto = on when the audio isn't in my language. */
  subtitles_mode: "auto" | "always" | "off";
  /** Prefer streams up to this quality. */
  max_quality: "max" | "1080p" | "720p" | "480p";
  /** +18 addons, lists and channels (turning it on takes the PIN). */
  adult_content: boolean;
  /** Profile photo (path on the API, e.g. /avatars/…); null = color + initial. */
  avatar_url?: string | null;
}

export type ProfileSettings = Partial<
  Pick<Profile, "name" | "color" | "language" | "ui_language" | "subtitle_language" | "subtitles_mode" | "max_quality" | "adult_content">
> & { pin?: string };

export const MAX_PROFILES = 5;

export interface InstalledAddon {
  id: number;
  transport_url: string;
  manifest: Manifest;
  position: number;
  enabled: boolean;
  adult?: boolean;
  installed_at: string;
  manifest_updated_at: string;
}

export interface AddonPreview {
  transport_url: string;
  manifest: Manifest;
  already_installed: boolean;
  adult?: boolean;
}

export interface Playlist {
  id: number;
  name: string;
  url: string;
  adult: boolean;
  position: number;
  created_at: string;
}
