import { ArrowLeft, Scale } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { APP_NAME } from "@/components/BrandLogo";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

/** Aviso legal: AetherIO is only a player; content comes from what each user adds. */
export default function Legal() {
  const navigate = useNavigate();
  const points = [
    t("{app} es un reproductor. No aloja, no indexa y no distribuye películas, series, canales ni ningún otro contenido.", { app: APP_NAME }),
    t("{app} no trae preinstalado ni recomienda ningún addon, lista de canales o servicio de terceros.", { app: APP_NAME }),
    t("Cada usuario elige y agrega sus propias fuentes, y es responsable de tener derecho a usarlas y de cumplir las leyes de su país y los términos de esos servicios."),
    t("Los videos van directo del servidor de cada fuente a tu dispositivo: no pasan por los servidores de {app}.", { app: APP_NAME }),
    t("Las direcciones de los addons y listas que agregas se guardan cifradas y solo se usan para tu perfil."),
    t("Si un contenido infringe tus derechos, no está en nuestros servidores: dirígete al proveedor del addon, la lista o el sitio que lo publica."),
    t("{app} se ofrece tal cual, sin garantías de ningún tipo.", { app: APP_NAME }),
  ];
  return (
    <div className="min-h-svh bg-background px-4 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <Button variant="ghost" size="sm" className="w-fit" onClick={() => navigate(-1)}>
          <ArrowLeft />
          {t("Volver")}
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
          <Scale className="size-6 text-primary" />
          {t("Aviso legal")}
        </h1>
        <ul className="flex list-disc flex-col gap-3 pl-5 text-sm leading-relaxed text-muted-foreground">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">{t("Al usar {app} aceptas estas condiciones.", { app: APP_NAME })}</p>
      </div>
    </div>
  );
}
