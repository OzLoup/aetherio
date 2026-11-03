import { Check, ExternalLink, Loader2, Plus, RotateCw, Search, Settings2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAddons } from "@/hooks/useAddons";
import { useProfiles } from "@/context/ProfileContext";
import { loadDirectory, searchDirectory, type AddonKind, type DirectoryAddon } from "@/lib/addonDirectory";
import { configureUrl } from "@/lib/stremio";
import { AddonBadges } from "./AddonBadges";
import { AddonLogo } from "./AddonLogo";
import { t } from "@/i18n";

const KINDS: { value: AddonKind; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "catalog", label: "Catálogos" },
  { value: "stream", label: "Streams" },
  { value: "subtitles", label: "Subtítulos" },
];
const PAGE = 30;

/** Search the public community directories and install from there. Opens
 * the usual install dialog (which shows what the addon does) — nothing is
 * installed without it. */
export function CommunityAddons({ onInstall }: { onInstall: (url: string) => void }) {
  const { addons } = useAddons();
  const { current } = useProfiles();
  const [list, setList] = useState<DirectoryAddon[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<AddonKind>("");
  const [shown, setShown] = useState(PAGE);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDirectory().then((l) => {
      if (cancelled) return;
      setList(l);
      setFailed(l.length === 0);
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const installedIds = useMemo(() => new Set(addons.map((a) => (a.manifest as { id?: string }).id)), [addons]);
  const results = useMemo(
    () => (list ? searchDirectory(list, query, kind, Boolean(current?.adult_content)) : []),
    [list, query, kind, current?.adult_content],
  );

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{t("Explorar addons de la comunidad")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("Directorios públicos de Stremio y stremio-addons.net. AetherIO no los revisa ni los recomienda: los hace cada autor.")}
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder={t("Buscar por nombre o descripción (p. ej. anime, latino, netflix)")}
            className="pl-9"
            aria-label={t("Buscar addons")}
          />
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("Tipo de addon")}>
          {KINDS.map((k) => (
            <Button
              key={k.value}
              size="sm"
              variant={kind === k.value ? "default" : "outline"}
              onClick={() => {
                setKind(k.value);
                setShown(PAGE);
              }}
            >
              {t(k.label)}
            </Button>
          ))}
        </div>
      </div>

      {list === null ? (
        <div className="flex justify-center py-10">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : failed ? (
        <div className="flex flex-col items-center gap-3 py-10 text-sm text-muted-foreground">
          {t("No se pudo cargar el directorio de addons.")}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFailed(false);
              setList(null);
              setAttempt((n) => n + 1);
            }}
          >
            <RotateCw />
            {t("Reintentar")}
          </Button>
        </div>
      ) : results.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("Ningún addon coincide con la búsqueda.")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("{n} addons", { n: results.length })}</p>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {results.slice(0, shown).map(({ transportUrl, manifest }) => {
              const needsSetup = Boolean(manifest.behaviorHints?.configurationRequired);
              const canConfigure = needsSetup || Boolean(manifest.behaviorHints?.configurable);
              return (
                <li key={transportUrl} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <div className="flex items-start gap-3">
                    <AddonLogo src={manifest.logo} name={manifest.name} className="size-10 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{manifest.name}</p>
                      {manifest.description && <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{manifest.description}</p>}
                    </div>
                  </div>
                  <AddonBadges manifest={manifest} />
                  <div className="flex flex-wrap items-center gap-2">
                    {installedIds.has(manifest.id) ? (
                      <span className="flex items-center gap-1 text-sm text-success">
                        <Check className="size-4" /> {t("Instalado")}
                      </span>
                    ) : needsSetup ? (
                      <a href={configureUrl(transportUrl)} target="_blank" rel="noreferrer" className={buttonVariants({ size: "sm" })}>
                        <Settings2 />
                        {t("Configurar e instalar")}
                        <ExternalLink className="size-3.5" />
                      </a>
                    ) : (
                      <Button size="sm" onClick={() => onInstall(transportUrl)}>
                        <Plus />
                        {t("Instalar")}
                      </Button>
                    )}
                    {canConfigure && !needsSetup && !installedIds.has(manifest.id) && (
                      <a href={configureUrl(transportUrl)} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline-offset-2 hover:underline">
                        {t("Configurar")}
                      </a>
                    )}
                  </div>
                  {needsSetup && (
                    <p className="text-xs text-muted-foreground">
                      {t("Pide configurarlo en su página. Al terminar, copia el enlace de instalación y pégalo en \"Instalar addon\".")}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          {results.length > shown && (
            <div className="flex justify-center">
              <Button variant="outline" onClick={() => setShown((n) => n + PAGE)}>
                {t("Ver más")}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
