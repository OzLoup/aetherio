import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { GOOGLE_ERRORS } from "../components/GoogleLogin";
import { useAuth } from "../context/AuthContext";
import { t } from "@/i18n";

/** Landing page for the Google OAuth redirect: the backend hands the JWT
 * back in the URL fragment (#token=...) so it never touches server logs. */
export default function AuthCallback() {
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash);
    const token = params.get("token");
    const error = params.get("error");

    if (token) {
      loginWithToken(token).then(() => navigate("/", { replace: true }));
    } else {
      navigate("/login", { replace: true, state: error ? { error: GOOGLE_ERRORS[error] ?? GOOGLE_ERRORS.google } : null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-3 bg-background">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{t("Entrando...")}</p>
    </div>
  );
}
