import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL, api } from "@/api/client";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useAuth } from "@/context/AuthContext";
import { desktop } from "@/lib/desktop";
import { GoogleIcon } from "./GoogleIcon";
import { t } from "@/i18n";

export const GOOGLE_ERRORS: Record<string, string> = {
  google: "No se pudo entrar con Google. Vuelve a intentarlo.",
  google_email: "Tu cuenta de Google no tiene un email verificado.",
};

/** "Continuar con Google", only when the server has it configured. In the
 * macOS app it opens the system browser (Google blocks logins inside app
 * windows) and the result comes back through aetherio://. */
export function GoogleLogin({ onError }: { onError: (message: string) => void }) {
  const [enabled, setEnabled] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ google: boolean }>("/auth/providers")
      .then(({ data }) => setEnabled(data.google))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!desktop) return;
    return desktop.onAuth(async ({ token, error }) => {
      setWaiting(false);
      if (token) {
        await loginWithToken(token);
        navigate("/", { replace: true });
      } else {
        onError(t(GOOGLE_ERRORS[error ?? "google"] ?? GOOGLE_ERRORS.google));
      }
    });
  }, [loginWithToken, navigate, onError]);

  if (!enabled) return null;

  const href = `${API_BASE_URL}/auth/google/login?client=${desktop ? "desktop" : "web"}`;
  const button = buttonVariants({ variant: "outline", className: "w-full" });

  return (
    <>
      <div className="my-4 flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">o</span>
        <Separator className="flex-1" />
      </div>
      {desktop ? (
        <button
          type="button"
          className={button}
          onClick={() => {
            setWaiting(true);
            desktop!.openExternal(href);
          }}
        >
          {waiting ? <Loader2 className="size-4 animate-spin" /> : <GoogleIcon className="size-4" />}
          {waiting ? t("Continúa en tu navegador…") : t("Continuar con Google")}
        </button>
      ) : (
        <a href={href} className={button}>
          <GoogleIcon className="size-4" />
          {t("Continuar con Google")}
        </a>
      )}
    </>
  );
}
