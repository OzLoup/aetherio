import { Check, Loader2, Plus, Power, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { API_BASE_URL, getErrorDetail } from "@/api/client";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { useAddons } from "@/hooks/useAddons";
import { t } from "@/i18n";

interface Country {
  code: string;
  name: string;
}

const BASE = `${API_BASE_URL}/stremio/tmdb`;

function ownCatalogsUrl(country: string) {
  return `${BASE}/${country}/manifest.json`;
}

/** "Catálogos AetherIO": our own TMDB catalogs (what's on Netflix, Max…
 * in a country). One install per profile, for the country picked here.
 * Hidden when the backend has them off (no TMDB key). */
export function OwnCatalogs() {
  const { addons, install, setEnabled } = useAddons();
  const [countries, setCountries] = useState<Country[] | null>(null);
  const [country, setCountry] = useState("MX");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/countries.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => !cancelled && setCountries(d?.enabled ? d.countries : []))
      .catch(() => !cancelled && setCountries([]));
    return () => {
      cancelled = true;
    };
  }, []);

  if (!countries?.length) return null;
  const installed = addons.filter((a) => a.transport_url.startsWith(`${BASE}/`));
  const url = ownCatalogsUrl(country);
  const existing = addons.find((a) => a.transport_url === url);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      if (existing) await setEnabled(existing.id, true);
      else await install(url);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo instalar el addon"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <Tv className="mt-0.5 size-6 shrink-0 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">{t("Catálogos AetherIO")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("Qué hay en Netflix, Prime Video, Disney+, Max, Apple TV+ y Paramount+ en tu país, tendencias y estrenos. En español, ordenados por popularidad, fecha, valoración o A–Z sobre todo el catálogo.")}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect aria-label={t("País")} value={country} onChange={(e) => setCountry(e.target.value)} className="w-auto">
          {countries.map((c) => (
            <option key={c.code} value={c.code}>
              {c.name}
            </option>
          ))}
        </NativeSelect>
        {existing?.enabled ? (
          <span className="flex items-center gap-1 text-sm text-success">
            <Check className="size-4" /> {t("Instalado")}
          </span>
        ) : (
          <Button size="sm" onClick={add} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : existing ? <Power /> : <Plus />}
            {existing ? t("Activar") : t("Instalar")}
          </Button>
        )}
      </div>
      {installed.length > 0 && !existing && (
        <p className="text-xs text-muted-foreground">{t("Ya tienes los de otro país; puedes tener varios o quitar el que no uses.")}</p>
      )}
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">{t("Datos de TMDB y JustWatch. Solo información de los títulos: lo que se reproduce sigue viniendo de tus addons.")}</p>
    </section>
  );
}
