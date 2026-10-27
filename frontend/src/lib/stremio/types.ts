// Stremio addon protocol types.
// Spec: https://github.com/Stremio/stremio-addon-sdk/tree/master/docs/api
//
// This folder (lib/stremio) is intentionally framework-free (no React, no
// axios) so it can move to a shared package for the Android app later.

export type ResourceName = "catalog" | "meta" | "stream" | "subtitles" | "addon_catalog" | (string & {});

export interface ResourceDescriptor {
  name: ResourceName;
  types?: string[];
  idPrefixes?: string[];
}

export interface ExtraProperty {
  name: string;
  isRequired?: boolean;
  options?: string[];
  optionsLimit?: number;
}

export interface CatalogDescriptor {
  type: string;
  id: string;
  name?: string;
  extra?: ExtraProperty[];
  extraSupported?: string[];
  extraRequired?: string[];
}

export interface BehaviorHints {
  adult?: boolean;
  p2p?: boolean;
  configurable?: boolean;
  configurationRequired?: boolean;
}

export interface Manifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  resources: (ResourceName | ResourceDescriptor)[];
  types: string[];
  catalogs?: CatalogDescriptor[];
  idPrefixes?: string[];
  logo?: string;
  background?: string;
  behaviorHints?: BehaviorHints;
}

export type PosterShape = "poster" | "square" | "landscape";

export interface MetaLink {
  name: string;
  category: string;
  url: string;
}

export interface Video {
  id: string;
  title?: string;
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  released?: string;
  thumbnail?: string;
  overview?: string;
  description?: string;
}

export interface Trailer {
  ytId?: string;
  source?: string;
  title?: string;
  type?: string;
}

/** Item as returned by a catalog. */
export interface MetaPreview {
  id: string;
  type: string;
  name: string;
  poster?: string;
  posterShape?: PosterShape;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  year?: string;
  imdbRating?: string;
  genres?: string[];
  /** Legacy alias of `genres`, still sent by Cinemeta. */
  genre?: string[];
  runtime?: string;
  links?: MetaLink[];
}

/** Full item as returned by the meta resource. */
export interface MetaDetail extends MetaPreview {
  videos?: Video[];
  director?: string[];
  cast?: string[];
  writer?: string[];
  country?: string;
  released?: string;
  trailers?: Trailer[];
  trailerStreams?: { title?: string; ytId?: string }[];
  behaviorHints?: { defaultVideoId?: string | null; [key: string]: unknown };
}

/** An installed addon as far as the protocol cares. */
export interface AddonRef {
  transportUrl: string;
  manifest: Manifest;
}

export type Extra = Record<string, string>;

export interface StreamBehaviorHints {
  notWebReady?: boolean;
  bingeGroup?: string;
  filename?: string;
  videoSize?: number;
  videoHash?: string;
  countryWhitelist?: string[];
  proxyHeaders?: { request?: Record<string, string>; response?: Record<string, string> };
  [key: string]: unknown;
}

export interface Subtitle {
  id: string;
  url: string;
  lang: string;
}

/** One way to watch an item, as returned by the stream resource. Exactly
 * one of url / ytId / infoHash / externalUrl is expected. */
export interface Stream {
  url?: string;
  ytId?: string;
  infoHash?: string;
  fileIdx?: number;
  externalUrl?: string;
  name?: string;
  /** Deprecated in favour of `description`, still used by most addons. */
  title?: string;
  description?: string;
  subtitles?: Subtitle[];
  behaviorHints?: StreamBehaviorHints;
}
