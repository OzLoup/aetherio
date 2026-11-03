/** Shown as one-click suggestions when a profile has no catalogs. Nothing is
 * installed automatically. Only metadata/subtitle addons here (no streams,
 * no torrents). The own TMDB catalogs are offered by <OwnCatalogs />. */
export const SUGGESTED_ADDONS = [
  {
    name: "Cinemeta",
    description: "Catálogos y fichas de películas y series (el addon oficial de Stremio).",
    url: "https://v3-cinemeta.strem.io/manifest.json",
  },
  {
    name: "OpenSubtitles v3",
    description: "Subtítulos en muchos idiomas.",
    url: "https://opensubtitles-v3.strem.io/manifest.json",
  },
  {
    name: "Streaming Catalogs",
    description: "Catálogos de Netflix, HBO Max, Disney+, Prime Video y Apple TV+ (addon de la comunidad).",
    url: "https://7a82163c306e-stremio-netflix-catalog-addon.baby-beamup.club/manifest.json",
  },
];
