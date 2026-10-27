import { Check, Loader2, Plus, Power, Puzzle } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getErrorDetail } from "@/api/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { useAddons } from "@/hooks/useAddons";
import { SUGGESTED_ADDONS } from "@/lib/suggestedAddons";
import { t } from "@/i18n";

/** Empty state for a profile without catalogs: one-click suggestions. */
export function SuggestedAddons() {
  const { addons, install, setEnabled } = useAddons();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byUrl = new Map(addons.map((a) => [a.transport_url, a]));

  async function handleInstall(url: string) {
    setBusy(url);
    setError(null);
    try {
      // Installed but switched off: turning it on is all that's missing.
      const existing = byUrl.get(url);
      if (existing) await setEnabled(existing.id, true);
      else await install(url);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo instalar el addon"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 rounded-xl border border-border bg-card px-6 py-12 text-center">
      <Puzzle className="size-10 text-primary" />
      <div className="flex max-w-md flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("Este perfil todavía no tiene catálogos")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("El contenido viene de los addons que instales. Puedes empezar con estos o pegar la URL de cualquier addon de Stremio.")}
        </p>
      </div>
      <ul className="flex w-full max-w-lg flex-col gap-2 text-left">
        {SUGGESTED_ADDONS.map((s) => (
          <li key={s.url} className="flex items-center gap-3 rounded-lg border border-border p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.name}</p>
              <p className="text-sm text-muted-foreground">{t(s.description)}</p>
            </div>
            {byUrl.get(s.url)?.enabled ? (
              <span className="flex items-center gap-1 text-sm text-success">
                <Check className="size-4" /> {t("Instalado")}
              </span>
            ) : (
              <Button size="sm" onClick={() => handleInstall(s.url)} disabled={busy !== null}>
                {busy === s.url ? <Loader2 className="animate-spin" /> : byUrl.has(s.url) ? <Power /> : <Plus />}
                {byUrl.has(s.url) ? t("Activar") : t("Instalar")}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Link to="/addons" className={buttonVariants({ variant: "outline" })}>
        {t("Instalar otro addon")}
      </Link>
    </div>
  );
}
