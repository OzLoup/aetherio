import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { openInVlc, VLC_APP_STORE } from "@/lib/vlc";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

/** "Abrir en VLC", plus an App Store link if VLC didn't open. */
export function VlcButton({
  url,
  size = "sm",
  variant = "outline",
  className,
  label,
  onOpened,
}: {
  url: string;
  size?: "sm" | "lg" | "default";
  variant?: "outline" | "default" | "secondary";
  className?: string;
  label?: string;
  onOpened?: () => void;
}) {
  const [missing, setMissing] = useState(false);
  return (
    <span className={cn("inline-flex flex-col items-center gap-1", className)}>
      <Button
        size={size}
        variant={variant}
        className="w-full"
        onClick={async (e) => {
          e.stopPropagation();
          const opened = await openInVlc(url);
          setMissing(!opened);
          if (opened) onOpened?.();
        }}
      >
        <ExternalLink />
        {label ?? t("Abrir en VLC")}
      </Button>
      {missing && (
        <a href={VLC_APP_STORE} target="_blank" rel="noreferrer" className="text-xs text-muted-foreground underline">
          {t("¿No se abrió? Instala VLC")}
        </a>
      )}
    </span>
  );
}
