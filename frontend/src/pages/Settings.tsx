import { Check, Gauge, Globe, KeyRound, ShieldCheck, Loader2, LogOut, Moon, Palette, Subtitles, Sun, User as UserIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, getErrorDetail } from "@/api/client";
import { PROFILE_COLORS, type ProfileSettings } from "@/api/types";
import { APP_NAME } from "@/components/BrandLogo";
import { ProfileAvatar } from "@/components/profiles/ProfileAvatar";
import { AvatarEditor } from "@/components/profiles/AvatarEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { PinDialog } from "@/components/profiles/PinDialog";
import { useAuth } from "@/context/AuthContext";
import { useProfiles } from "@/context/ProfileContext";
import { useTheme } from "@/context/ThemeContext";
import { t, UI_LANGUAGES } from "@/i18n";
import { desktop } from "@/lib/desktop";
import { LANGUAGES, type LanguageCode } from "@/lib/languages";
import { cn } from "@/lib/utils";

function Section({ icon, title, description, children }: { icon: ReactNode; title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary [&_svg]:size-4">{icon}</div>
        <div>
          <h2 className="font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, htmlFor, children }: { label: string; hint?: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-[14rem_1fr] sm:items-center sm:gap-4">
      <div>
        <Label htmlFor={htmlFor}>{label}</Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

/** Settings of the current profile + the account. */
export default function Settings() {
  const { current, update } = useProfiles();
  const { user, logout, refresh } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(current?.name ?? "");
  const [accountName, setAccountName] = useState(user?.name ?? "");
  const [pw, setPw] = useState({ current: "", next: "" });
  const [pwState, setPwState] = useState<"idle" | "saving" | "done">("idle");

  if (!current) return null;

  async function save(changes: ProfileSettings) {
    if (!current) return;
    setError(null);
    try {
      await update(current.id, changes);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(t(getErrorDetail(err) ?? t("No se pudo guardar el cambio")));
    }
  }

  async function saveAccountName(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.patch("/auth/me", { name: accountName });
      await refresh();
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (err) {
      setError(t(getErrorDetail(err) ?? t("No se pudo guardar el cambio")));
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setPwState("saving");
    try {
      await api.post("/auth/password", { current_password: pw.current || null, new_password: pw.next });
      setPw({ current: "", next: "" });
      setPwState("done");
      await refresh();
    } catch (err) {
      setError(t(getErrorDetail(err) ?? t("No se pudo cambiar la contraseña")));
      setPwState("idle");
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("Ajustes")}</h1>
        <span className={cn("flex items-center gap-1 text-sm text-success transition-opacity", saved ? "opacity-100" : "opacity-0")} aria-live="polite">
          <Check className="size-4" />
          {t("Guardado")}
        </span>
      </div>
      {error && <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>}

      <Section icon={<UserIcon />} title={t("Perfil")} description={t("Solo afecta a este perfil: {name}.", { name: current.name })}>
        <Field label={t("Nombre a mostrar")} htmlFor="s-name">
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim() && name.trim() !== current.name) save({ name: name.trim() });
            }}
          >
            <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={50} />
            <Button type="submit" variant="outline" disabled={!name.trim() || name.trim() === current.name}>
              {t("Guardar")}
            </Button>
          </form>
        </Field>
        <Field label={t("Foto de perfil")} hint={t("Opcional. Si no subes una, se muestra la inicial sobre el color.")}>
          <AvatarEditor profile={current} />
        </Field>
        <Field label={t("Color del avatar")}>
          <div className="flex flex-wrap items-center gap-2">
            <ProfileAvatar profile={current} size="sm" className="mr-1" />
            {PROFILE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => save({ color: c })}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg text-white ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  current.color === c && "ring-2 ring-foreground",
                )}
                style={{ background: `var(--${c})` }}
                aria-label={t("Color {n}", { n: c.replace("series-", "") })}
                aria-pressed={current.color === c}
              >
                {current.color === c && <Check className="size-4" />}
              </button>
            ))}
          </div>
        </Field>
      </Section>

      <Section icon={<Globe />} title={t("Idioma")}>
        <Field label={t("Idioma de la aplicación")} htmlFor="s-ui">
          <NativeSelect id="s-ui" value={current.ui_language} onChange={(e) => save({ ui_language: e.target.value as "es" | "en" })}>
            {UI_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("Audio preferido")} hint={t("Se muestran primero los streams en este idioma.")} htmlFor="s-audio">
          <NativeSelect id="s-audio" value={current.language} onChange={(e) => save({ language: e.target.value as LanguageCode })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {t(l.label)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </Section>

      <Section icon={<Subtitles />} title={t("Subtítulos")}>
        <Field label={t("Idioma de subtítulos")} htmlFor="s-subs">
          <NativeSelect
            id="s-subs"
            value={current.subtitle_language}
            onChange={(e) => save({ subtitle_language: e.target.value as LanguageCode })}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {t(l.label)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field label={t("Mostrar subtítulos")} htmlFor="s-mode">
          <NativeSelect
            id="s-mode"
            value={current.subtitles_mode}
            onChange={(e) => save({ subtitles_mode: e.target.value as "auto" | "always" | "off" })}
          >
            <option value="auto">{t("Automático: solo si el audio no está en mi idioma")}</option>
            <option value="always">{t("Siempre")}</option>
            <option value="off">{t("Nunca (los activo yo)")}</option>
          </NativeSelect>
        </Field>
      </Section>

      <Section icon={<Gauge />} title={t("Reproducción")}>
        <Field
          label={t("Calidad máxima")}
          hint={t("Útil si tu internet es lento: se prefieren streams de esta calidad o menor.")}
          htmlFor="s-quality"
        >
          <NativeSelect
            id="s-quality"
            value={current.max_quality}
            onChange={(e) => save({ max_quality: e.target.value as "max" | "1080p" | "720p" | "480p" })}
          >
            <option value="max">{t("La mejor disponible")}</option>
            <option value="1080p">1080p</option>
            <option value="720p">720p</option>
            <option value="480p">480p</option>
          </NativeSelect>
        </Field>
      </Section>

      <Section icon={<Palette />} title={t("Apariencia")}>
        <Field label={t("Tema")}>
          <Button variant="outline" className="w-fit" onClick={toggleTheme}>
            {theme === "dark" ? <Moon /> : <Sun />}
            {theme === "dark" ? t("Oscuro") : t("Claro")}
          </Button>
        </Field>
      </Section>

      <ParentalControl onSaved={() => { setSaved(true); window.setTimeout(() => setSaved(false), 1800); }} />

      <Section icon={<KeyRound />} title={t("Cuenta")} description={user?.email}>
        <Field label={t("Nombre de la cuenta")} htmlFor="s-account">
          <form className="flex gap-2" onSubmit={saveAccountName}>
            <Input id="s-account" value={accountName} onChange={(e) => setAccountName(e.target.value)} maxLength={255} />
            <Button type="submit" variant="outline" disabled={accountName === (user?.name ?? "")}>
              {t("Guardar")}
            </Button>
          </form>
        </Field>
        <Field
          label={user?.has_password ? t("Cambiar contraseña") : t("Crear contraseña")}
          hint={user?.google_linked ? t("Tu cuenta también entra con Google.") : undefined}
        >
          <form className="flex flex-col gap-2" onSubmit={changePassword}>
            {user?.has_password && (
              <Input
                type="password"
                placeholder={t("Contraseña actual")}
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                autoComplete="current-password"
              />
            )}
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder={t("Nueva contraseña (mínimo 8)")}
                value={pw.next}
                minLength={8}
                onChange={(e) => {
                  setPw({ ...pw, next: e.target.value });
                  setPwState("idle");
                }}
                autoComplete="new-password"
              />
              <Button type="submit" variant="outline" disabled={pw.next.length < 8 || pwState === "saving"}>
                {pwState === "saving" ? <Loader2 className="animate-spin" /> : pwState === "done" ? <Check /> : null}
                {pwState === "done" ? t("Listo") : t("Guardar")}
              </Button>
            </div>
          </form>
        </Field>
        <Field label={t("Sesión")}>
          <Button
            variant="outline"
            className="w-fit text-destructive"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            <LogOut />
            {t("Cerrar sesión")}
          </Button>
        </Field>
      </Section>

      <p className="text-center text-xs text-muted-foreground">
        {APP_NAME} {desktop ? `· ${t("app de Mac")} v${desktop.version}` : `· ${t("versión web")}`} ·{" "}
        <Link to="/legal" className="underline hover:text-foreground">
          {t("Aviso legal")}
        </Link>
      </p>
    </div>
  );
}

/** Account PIN + "allow +18 content" for this profile (turning it on takes the PIN). */
function ParentalControl({ onSaved }: { onSaved: () => void }) {
  const { current, update } = useProfiles();
  const { user, refresh } = useAuth();
  const [pinForm, setPinForm] = useState({ current: "", next: "", confirm: "" });
  const [pinState, setPinState] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  if (!current) return null;
  const hasPin = Boolean(user?.has_pin);

  async function savePin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (pinForm.next !== pinForm.confirm) return setError(t("Los PIN no coinciden"));
    setPinState("saving");
    try {
      const old = pinForm.current;
      await api.put("/auth/pin", {
        pin: pinForm.next,
        // The current PIN, or the account password if it was forgotten.
        current_pin: hasPin && /^\d{4,8}$/.test(old) ? old : null,
        password: hasPin ? old : null,
      });
      setPinForm({ current: "", next: "", confirm: "" });
      setPinState("done");
      await refresh();
      onSaved();
    } catch (err) {
      setError(t(getErrorDetail(err) ?? t("No se pudo guardar el PIN")));
      setPinState("idle");
    }
  }

  async function toggleAdult(on: boolean) {
    setError(null);
    if (!on) {
      try {
        await update(current!.id, { adult_content: false });
        onSaved();
      } catch (err) {
        setError(t(getErrorDetail(err) ?? t("No se pudo guardar el cambio")));
      }
      return;
    }
    if (!hasPin) return setError(t("Primero crea un PIN de control parental (abajo)."));
    setAsking(true);
  }

  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 8);

  return (
    <Section
      icon={<ShieldCheck />}
      title={t("Control parental")}
      description={t("El contenido para adultos (+18) está apagado en cada perfil hasta que lo actives con el PIN.")}
    >
      {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      <label className="flex items-start gap-3">
        <Switch checked={current.adult_content} onCheckedChange={toggleAdult} className="mt-0.5" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-medium">{t("Permitir contenido para adultos en {name}", { name: current.name })}</span>
          <span className="text-xs text-muted-foreground">
            {t("Activarlo pide el PIN; apagarlo no. Mientras está apagado, los addons, listas y canales +18 de este perfil se ocultan.")}
          </span>
        </span>
      </label>

      <form onSubmit={savePin} className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="text-sm font-medium">{hasPin ? t("Cambiar PIN") : t("Crear PIN")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {hasPin && (
            <Field label={t("PIN actual o contraseña")} htmlFor="pin-current">
              <Input id="pin-current" type="password" autoComplete="off" value={pinForm.current} onChange={(e) => setPinForm({ ...pinForm, current: e.target.value })} />
            </Field>
          )}
          <Field label={t("PIN nuevo (4 a 8 números)")} htmlFor="pin-new">
            <Input id="pin-new" type="password" inputMode="numeric" autoComplete="off" value={pinForm.next} onChange={(e) => setPinForm({ ...pinForm, next: digits(e.target.value) })} />
          </Field>
          <Field label={t("Repite el PIN")} htmlFor="pin-confirm">
            <Input id="pin-confirm" type="password" inputMode="numeric" autoComplete="off" value={pinForm.confirm} onChange={(e) => setPinForm({ ...pinForm, confirm: digits(e.target.value) })} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit" variant="outline" disabled={pinState === "saving" || pinForm.next.length < 4 || (hasPin && !pinForm.current)}>
            {pinState === "saving" && <Loader2 className="animate-spin" />}
            {hasPin ? t("Cambiar PIN") : t("Crear PIN")}
          </Button>
          {pinState === "done" && <span className="text-sm text-success">{t("PIN guardado")}</span>}
        </div>
        <p className="text-xs text-muted-foreground">{t("El PIN es de la cuenta: sirve para todos los perfiles. Si lo olvidas, cámbialo con la contraseña de la cuenta.")}</p>
      </form>

      <PinDialog
        open={asking}
        onOpenChange={setAsking}
        title={t("Permitir contenido para adultos")}
        description={t("Escribe el PIN de control parental para activarlo en {name}.", { name: current.name })}
        onSubmit={async (pin) => {
          await update(current.id, { adult_content: true, pin });
          onSaved();
        }}
      />
    </Section>
  );
}
