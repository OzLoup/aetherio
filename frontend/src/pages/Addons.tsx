import { Loader2, Plus, Puzzle } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AddonCard } from "@/components/addons/AddonCard";
import { InstallAddonDialog } from "@/components/addons/InstallAddonDialog";
import { Button } from "@/components/ui/button";
import { useAddons } from "@/hooks/useAddons";
import { t } from "@/i18n";

/** Addon manager. `/addons?install=<url>` opens the install dialog
 * pre-filled, so a Stremio install link can be pasted straight into the app. */
export default function Addons() {
  const { addons, loading, error, preview, install, setEnabled, move, refresh, uninstall } = useAddons();
  const [params, setParams] = useSearchParams();
  const installParam = params.get("install") ?? undefined;
  const [dialogOpen, setDialogOpen] = useState(Boolean(installParam));

  function handleDialogChange(open: boolean) {
    setDialogOpen(open);
    if (!open && installParam) {
      params.delete("install");
      setParams(params, { replace: true });
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("Addons")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("Los addons traen catálogos, metadatos, streams y subtítulos. El orden define la prioridad.")}
          </p>
        </div>
        <Button size="lg" onClick={() => setDialogOpen(true)}>
          <Plus />
          {t("Instalar addon")}
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      ) : addons.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <Puzzle className="size-8 text-muted-foreground" />
          <p className="font-medium">{t("Todavía no tienes addons")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            {t("Instala uno pegando su URL. Sin addons no hay catálogos ni contenido que reproducir.")}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {addons.map((addon, i) => (
            <AddonCard
              key={addon.id}
              addon={addon}
              isFirst={i === 0}
              isLast={i === addons.length - 1}
              onToggle={(enabled) => setEnabled(addon.id, enabled)}
              onMove={(dir) => move(addon.id, dir)}
              onRefresh={() => refresh(addon.id)}
              onUninstall={() => uninstall(addon.id)}
            />
          ))}
        </div>
      )}

      <InstallAddonDialog
        open={dialogOpen}
        onOpenChange={handleDialogChange}
        initialUrl={installParam}
        preview={preview}
        install={install}
      />
    </div>
  );
}
