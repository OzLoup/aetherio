import { Loader2, LogOut, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MAX_PROFILES, type Profile } from "@/api/types";
import { BrandLogo } from "@/components/BrandLogo";
import { ProfileAvatar } from "@/components/profiles/ProfileAvatar";
import { ProfileDialog } from "@/components/profiles/ProfileDialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/context/AuthContext";
import { useProfiles } from "@/context/ProfileContext";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

/** "¿Quién está viendo?" — choose (or manage, with ?manage=1) the profile. */
export default function ProfilePicker() {
  const { profiles, loading, select } = useProfiles();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const managing = params.get("manage") === "1";
  const [editing, setEditing] = useState<Profile | undefined>();
  const [dialogOpen, setDialogOpen] = useState(false);

  function toggleManage() {
    setParams(managing ? {} : { manage: "1" }, { replace: true });
  }

  function openDialog(profile?: Profile) {
    setEditing(profile);
    setDialogOpen(true);
  }

  function handlePick(profile: Profile) {
    if (managing) return openDialog(profile);
    select(profile.id);
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="flex items-center justify-between px-4 py-4 sm:px-8">
        <BrandLogo />
        <Button variant="ghost" size="sm" onClick={() => { logout(); navigate("/login"); }}>
          <LogOut />
          {t("Salir")}
        </Button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-4 pb-16">
        <h1 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">
          {managing ? t("Administrar perfiles") : t("¿Quién está viendo?")}
        </h1>

        {loading ? (
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        ) : (
          <ul className="flex max-w-3xl flex-wrap justify-center gap-6 sm:gap-8">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  onClick={() => handlePick(p)}
                  className="group flex w-28 flex-col items-center gap-3 rounded-xl p-1 focus-visible:outline-none sm:w-36"
                >
                  <div className="relative">
                    <ProfileAvatar
                      profile={p}
                      size="lg"
                      className="transition-transform group-hover:scale-105 group-focus-visible:scale-105 group-focus-visible:ring-4 group-focus-visible:ring-foreground"
                    />
                    {managing && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-black/50">
                        <Pencil className="size-8 text-white" />
                      </div>
                    )}
                  </div>
                  <span className="max-w-full truncate text-sm font-medium text-muted-foreground group-hover:text-foreground group-focus-visible:text-foreground">
                    {p.name}
                  </span>
                </button>
              </li>
            ))}
            {profiles.length < MAX_PROFILES && (
              <li>
                <button
                  onClick={() => openDialog()}
                  className="group flex w-28 flex-col items-center gap-3 rounded-xl p-1 focus-visible:outline-none sm:w-36"
                >
                  <div className="flex size-24 items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground transition-colors group-hover:border-foreground group-hover:text-foreground group-focus-visible:border-foreground group-focus-visible:text-foreground sm:size-32">
                    <Plus className="size-10" />
                  </div>
                  <span className="text-sm font-medium text-muted-foreground">{t("Agregar perfil")}</span>
                </button>
              </li>
            )}
          </ul>
        )}

        <Button variant={managing ? "default" : "outline"} size="lg" onClick={toggleManage} className={cn(loading && "invisible")}>
          {managing ? t("Listo") : t("Administrar perfiles")}
        </Button>
      </main>

      <ProfileDialog open={dialogOpen} onOpenChange={setDialogOpen} profile={editing} />
    </div>
  );
}
