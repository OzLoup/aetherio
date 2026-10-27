import { Loader2, Lock, Mail } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { BrandLogo } from "../components/BrandLogo";
import { GoogleLogin } from "../components/GoogleLogin";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useAuth } from "../context/AuthContext";
import { t } from "@/i18n";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const location = useLocation();
  const stateError = (location.state as { error?: string } | null)?.error;
  const [error, setError] = useState<string | null>(stateError ? t(stateError) : null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      navigate("/");
    } catch {
      setError(t("Email o contraseña incorrectos"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandLogo size="lg" layout="col" />
          <p className="text-sm text-muted-foreground">{t("Entra para ver tu contenido")}</p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6 shadow-sm">
          <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
            {error && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">{t("Email")}</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  className="pl-8"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">{t("Contraseña")}</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  className="pl-8"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>
            </div>

            <Button type="submit" disabled={loading} className="mt-1">
              {loading && <Loader2 className="animate-spin" />}
              {loading ? t("Entrando...") : t("Entrar")}
            </Button>
          </form>

          <GoogleLogin onError={setError} />
        </div>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          {t("¿No tienes cuenta?")}{" "}
          <Link to="/register" className="font-medium text-primary hover:underline">
            {t("Regístrate")}
          </Link>
        </p>
      </div>
    </div>
  );
}
