import { Camera, Loader2, Trash2, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import { getErrorDetail } from "@/api/client";
import type { Profile } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProfiles } from "@/context/ProfileContext";
import { cropToBlob, type PixelArea } from "@/lib/cropImage";
import { ProfileAvatar } from "./ProfileAvatar";
import { t } from "@/i18n";

/** Profile photo: pick an image, crop it to a square, upload; or remove it
 * (the profile then shows its color with the initial). */
export function AvatarEditor({ profile }: { profile: Profile }) {
  const { setAvatar } = useProfiles();
  const input = useRef<HTMLInputElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<PixelArea | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Free the picked file's memory when done.
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);

  function pick(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError(t("Elige una imagen (JPG, PNG…)"));
    setError(null);
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setSrc(URL.createObjectURL(file));
  }

  async function save() {
    if (!src || !area) return;
    setBusy(true);
    setError(null);
    try {
      await setAvatar(profile.id, await cropToBlob(src, area));
      setSrc(null);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo guardar la foto"));
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    setError(null);
    try {
      await setAvatar(profile.id, null);
    } catch (err) {
      setError(getErrorDetail(err) ?? t("No se pudo quitar la foto"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <ProfileAvatar profile={profile} size="md" />
        <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()} disabled={busy}>
          <Camera />
          {profile.avatar_url ? t("Cambiar foto") : t("Subir foto")}
        </Button>
        {profile.avatar_url && (
          <Button type="button" variant="ghost" size="sm" onClick={removePhoto} disabled={busy}>
            <Trash2 />
            {t("Quitar foto")}
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && !src && <p className="text-sm text-destructive">{error}</p>}

      <Dialog open={src !== null} onOpenChange={(open) => !open && !busy && setSrc(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("Recortar foto")}</DialogTitle>
            <DialogDescription>{t("Arrastra para mover y usa el zoom para ajustar el encuadre.")}</DialogDescription>
          </DialogHeader>
          <div className="relative aspect-square w-full overflow-hidden rounded-lg bg-black">
            {src && (
              <Cropper
                image={src}
                crop={crop}
                zoom={zoom}
                aspect={1}
                maxZoom={4}
                showGrid={false}
                objectFit="cover"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_, pixels) => setArea(pixels)}
                style={{ cropAreaStyle: { borderRadius: "1rem" } }}
              />
            )}
          </div>
          <label className="flex items-center gap-3 text-sm">
            <ZoomIn className="size-4 text-muted-foreground" />
            <input
              type="range"
              min={1}
              max={4}
              step={0.01}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1 accent-[var(--primary)]"
              aria-label={t("Zoom")}
            />
          </label>
          {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSrc(null)} disabled={busy}>
              {t("Cancelar")}
            </Button>
            <Button onClick={save} disabled={busy || !area}>
              {busy && <Loader2 className="animate-spin" />}
              {t("Guardar foto")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
