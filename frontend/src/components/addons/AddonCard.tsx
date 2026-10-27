import { ChevronDown, ChevronUp, Copy, ExternalLink, Loader2, MoreVertical, RefreshCw, Trash2 } from "lucide-react";
import { useState } from "react";
import { getErrorDetail } from "@/api/client";
import type { InstalledAddon } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { configureUrl } from "@/lib/stremio";
import { cn } from "@/lib/utils";
import { AddonBadges } from "./AddonBadges";
import { AddonLogo } from "./AddonLogo";
import { t } from "@/i18n";

interface AddonCardProps {
  addon: InstalledAddon;
  isFirst: boolean;
  isLast: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onMove: (direction: -1 | 1) => Promise<void>;
  onRefresh: () => Promise<void>;
  onUninstall: () => Promise<void>;
}

export function AddonCard({ addon, isFirst, isLast, onToggle, onMove, onRefresh, onUninstall }: AddonCardProps) {
  const { manifest } = addon;
  const [busy, setBusy] = useState<"refresh" | "uninstall" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run(kind: "refresh" | "uninstall", fn: () => Promise<void>) {
    setBusy(kind);
    setError(null);
    try {
      await fn();
      if (kind === "uninstall") setConfirmOpen(false);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("Algo salió mal, intenta de nuevo"));
    } finally {
      setBusy(null);
    }
  }

  async function safely(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo guardar el cambio"));
    }
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(addon.transport_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t("No se pudo copiar la URL"));
    }
  }

  return (
    <Card className={cn("flex flex-col gap-3 p-4 transition-opacity", !addon.enabled && "opacity-60")}>
      <div className="flex items-start gap-3">
        <AddonLogo src={manifest.logo} name={manifest.name} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="truncate font-semibold">{manifest.name}</h3>
            <span className="shrink-0 text-xs text-muted-foreground">v{manifest.version}</span>
          </div>
          {manifest.description && (
            <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{manifest.description}</p>
          )}
        </div>
        <Switch
          checked={addon.enabled}
          onCheckedChange={(v) => safely(() => onToggle(v))}
          aria-label={addon.enabled ? `Desactivar ${manifest.name}` : `Activar ${manifest.name}`}
        />
      </div>

      <AddonBadges manifest={manifest} />

      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isFirst}
            onClick={() => safely(() => onMove(-1))}
            aria-label={t("Subir prioridad")}
          >
            <ChevronUp />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={isLast}
            onClick={() => safely(() => onMove(1))}
            aria-label={t("Bajar prioridad")}
          >
            <ChevronDown />
          </Button>
        </div>

        <div className="flex items-center gap-1">
          {manifest.behaviorHints?.configurable && (
            <a
              href={configureUrl(addon.transport_url)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-medium hover:bg-muted"
            >
              <ExternalLink className="size-3.5" />
              {t("Configurar")}
            </a>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t("Más opciones")}>
                {busy === "refresh" ? <Loader2 className="animate-spin" /> : <MoreVertical />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onSelect={() => run("refresh", onRefresh)}>
                <RefreshCw />
                {t("Actualizar manifest")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copyUrl}>
                <Copy />
                {copied ? t("¡Copiada!") : t("Copiar URL")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive focus:bg-destructive/10" onSelect={() => setConfirmOpen(true)}>
                <Trash2 />
                {t("Desinstalar")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("¿Desinstalar {name}?", { name: manifest.name })}</DialogTitle>
            <DialogDescription>
              {t("Dejarás de ver su contenido. Puedes volver a instalarlo con la misma URL cuando quieras.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("Cancelar")}</Button>
            </DialogClose>
            <Button variant="destructive" disabled={busy === "uninstall"} onClick={() => run("uninstall", onUninstall)}>
              {busy === "uninstall" && <Loader2 className="animate-spin" />}
              {t("Desinstalar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
