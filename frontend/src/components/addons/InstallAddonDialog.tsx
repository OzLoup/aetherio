import { AlertTriangle, Link2, Loader2, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { getErrorDetail } from "@/api/client";
import type { AddonPreview } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { configureUrl, type Manifest } from "@/lib/stremio";
import { AddonBadges } from "./AddonBadges";
import { AddonLogo } from "./AddonLogo";
import { useProfiles } from "@/context/ProfileContext";
import { t } from "@/i18n";

interface InstallAddonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialUrl?: string;
  preview: (url: string) => Promise<AddonPreview>;
  install: (url: string, manifest?: Manifest) => Promise<unknown>;
}

export function InstallAddonDialog({ open, onOpenChange, initialUrl, preview, install }: InstallAddonDialogProps) {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<AddonPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setUrl(initialUrl ?? "");
      setResult(null);
      setError(null);
    }
  }, [open, initialUrl]);

  async function handlePreview(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      setResult(await preview(url));
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo leer el addon"));
    } finally {
      setLoading(false);
    }
  }

  async function handleInstall() {
    if (!result) return;
    setLoading(true);
    setError(null);
    try {
      await install(result.transport_url, result.manifest);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo instalar el addon"));
    } finally {
      setLoading(false);
    }
  }

  const { current } = useProfiles();
  const needsConfig = result?.manifest.behaviorHints?.configurationRequired;
  // +18 addons install only on profiles that allow adult content.
  const adultBlocked = Boolean(result?.adult && !current?.adult_content);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("Instalar addon")}</DialogTitle>
          <DialogDescription>
            {t("Pega la URL del addon (la que termina en manifest.json). Funcionan los mismos addons de Stremio.")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handlePreview} className="flex flex-col gap-1.5">
          <Label htmlFor="addon-url">{t("URL del addon")}</Label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="addon-url"
                className="pl-8"
                placeholder="https://.../manifest.json"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setResult(null);
                }}
                autoFocus
                required
              />
            </div>
            <Button type="submit" variant="secondary" disabled={loading || !url.trim()}>
              {loading && !result ? <Loader2 className="animate-spin" /> : t("Revisar")}
            </Button>
          </div>
        </form>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {result && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="flex items-start gap-3">
              <AddonLogo src={result.manifest.logo} name={result.manifest.name} />
              <div className="min-w-0">
                <p className="font-semibold">
                  {result.manifest.name}{" "}
                  <span className="text-xs font-normal text-muted-foreground">v{result.manifest.version}</span>
                </p>
                {result.manifest.description && (
                  <p className="line-clamp-3 text-sm text-muted-foreground">{result.manifest.description}</p>
                )}
              </div>
            </div>
            <AddonBadges manifest={result.manifest} />
            {needsConfig && (
              <p className="flex gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {t("Este addon necesita configurarse primero.")}{" "}
                  <a href={configureUrl(result.transport_url)} target="_blank" rel="noreferrer" className="underline">
                    {t("Ábrelo aquí")}
                  </a>{" "}
                  {t("y pega la URL que te genere.")}
                </span>
              </p>
            )}
            {adultBlocked && (
              <p className="flex gap-2 rounded-md bg-warning/15 px-3 py-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {t("Este addon es para adultos (+18). Actívalo en Ajustes → Control parental de este perfil para instalarlo aquí.")}
              </p>
            )}
            {result.already_installed && <p className="text-sm text-muted-foreground">{t("Ya tienes este addon instalado.")}</p>}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("Cancelar")}
          </Button>
          <Button onClick={handleInstall} disabled={!result || loading || needsConfig || result.already_installed || adultBlocked}>
            {loading && result ? <Loader2 className="animate-spin" /> : <Plus />}
            {t("Instalar")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
