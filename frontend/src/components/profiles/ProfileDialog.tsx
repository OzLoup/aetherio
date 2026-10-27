import { Check, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { getErrorDetail } from "@/api/client";
import { PROFILE_COLORS, type Profile, type ProfileColor } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { useProfiles } from "@/context/ProfileContext";
import { LANGUAGES, type LanguageCode } from "@/lib/languages";
import { cn } from "@/lib/utils";
import { AvatarEditor } from "./AvatarEditor";
import { ProfileAvatar } from "./ProfileAvatar";
import { t } from "@/i18n";

interface ProfileDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Edit this profile; omit to create a new one. */
  profile?: Profile;
}

export function ProfileDialog({ open, onOpenChange, profile }: ProfileDialogProps) {
  const { profiles, create, update, remove } = useProfiles();
  // The photo uploads right away, so read it from the live list.
  const fresh = profile ? profiles.find((p) => p.id === profile.id) : undefined;
  const [name, setName] = useState("");
  const [color, setColor] = useState<ProfileColor>("series-1");
  const [language, setLanguage] = useState<LanguageCode>("es-419");
  const [copyFrom, setCopyFrom] = useState<string>("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(profile?.name ?? "");
    // New profiles get the first color nobody uses yet.
    const used = new Set(profiles.map((p) => p.color));
    setColor(profile?.color ?? PROFILE_COLORS.find((c) => !used.has(c)) ?? "series-1");
    setLanguage(profile?.language ?? "es-419");
    setCopyFrom("");
    setConfirmDelete(false);
    setError(null);
  }, [open, profile, profiles]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (profile) await update(profile.id, { name, color, language });
      else await create({ name, color, language, copyAddonsFrom: copyFrom ? Number(copyFrom) : undefined });
      onOpenChange(false);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo guardar el perfil"));
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      await remove(profile.id);
      onOpenChange(false);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo eliminar el perfil"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{profile ? t("Editar perfil") : t("Nuevo perfil")}</DialogTitle>
          <DialogDescription>{t("Cada perfil tiene sus propios addons y, pronto, su propio historial.")}</DialogDescription>
        </DialogHeader>

        <form id="profile-form" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex items-center gap-4">
            <ProfileAvatar profile={{ name: name || "?", color, avatar_url: fresh?.avatar_url }} size="md" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="profile-name">{t("Nombre")}</Label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                required
                autoFocus
              />
            </div>
          </div>

          {fresh && (
            <div className="flex flex-col gap-1.5">
              <Label>{t("Foto de perfil")}</Label>
              <AvatarEditor profile={fresh} />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>{t("Color")}</Label>
            <div className="flex flex-wrap gap-2">
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg text-white ring-offset-2 ring-offset-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    color === c && "ring-2 ring-foreground",
                  )}
                  style={{ background: `var(--${c})` }}
                  aria-label={`Color ${c.replace("series-", "")}`}
                  aria-pressed={color === c}
                >
                  {color === c && <Check className="size-4" />}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="profile-language">{t("Idioma preferido")}</Label>
            <NativeSelect
              id="profile-language"
              value={language}
              onChange={(e) => setLanguage(e.target.value as LanguageCode)}
            >
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {t(l.label)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{t("Se muestran primero los streams y subtítulos en este idioma.")}</p>
          </div>

          {!profile && profiles.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="copy-from">{t("Addons")}</Label>
              <NativeSelect id="copy-from" value={copyFrom} onChange={(e) => setCopyFrom(e.target.value)}>
                <option value="">{t("Empezar sin addons")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {t("Copiar los addons de {name}", { name: p.name })}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
        </form>

        {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        {confirmDelete && profile && (
          <div className="flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm">
              {t("Se eliminará {name} con sus addons. Esto no se puede deshacer.", { name: profile.name })}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                {t("Cancelar")}
              </Button>
              <Button variant="destructive" size="sm" onClick={handleDelete} disabled={busy}>
                {busy && <Loader2 className="animate-spin" />}
                {t("Eliminar perfil")}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter className="sm:justify-between">
          {profile && profiles.length > 1 ? (
            <Button variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(true)} disabled={busy}>
              <Trash2 />
              {t("Eliminar")}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t("Cancelar")}
            </Button>
            <Button type="submit" form="profile-form" disabled={busy || !name.trim()}>
              {busy && !confirmDelete && <Loader2 className="animate-spin" />}
              {t("Guardar")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
