import { AlertTriangle, BadgeCheck, Captions, ExternalLink, HardDrive, Loader2, Lock, Play, VolumeX, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { desktop } from "@/lib/desktop";
import { streamLangLabel, type StreamLang } from "@/lib/languages";
import { isMultiAudio, isPlayable, type ParsedStream } from "@/lib/streams";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export function StreamCard({
  s,
  onSelect,
  verified,
  verifying,
}: {
  s: ParsedStream;
  onSelect: (s: ParsedStream) => void;
  /** macOS app: audio languages read from the file itself (null = couldn't). */
  verified?: StreamLang[] | null;
  verifying?: boolean;
}) {
  const real = verified && verified.length ? verified : null;
  const playable = isPlayable(s);
  const opensOutside = s.kind === "external" || s.kind === "youtube";
  const disabled = s.kind === "torrent";

  return (
    <li>
      <button
        onClick={() => onSelect(s)}
        disabled={disabled}
        className={cn(
          "flex w-full items-start gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary focus-visible:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          disabled && "cursor-not-allowed opacity-50 hover:border-border",
        )}
      >
        <div className="flex w-14 shrink-0 flex-col items-center gap-1 pt-0.5">
          <span className="text-sm font-bold">{s.quality ?? "—"}</span>
          {s.cached === true && (
            <span className="flex items-center gap-0.5 text-[11px] font-semibold text-success" title={t("Ya está en tu debrid: empieza de inmediato")}>
              <Zap className="size-3 fill-current" />
              {t("Listo")}
            </span>
          )}
          {s.cached === false && (
            <span className="text-center text-[11px] leading-tight text-warning" title={t("Tu debrid todavía tiene que descargarlo")}>
              {t("No en caché")}
            </span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="truncate text-sm font-medium">{s.headline}</p>
          {s.details && <p className="line-clamp-3 whitespace-pre-line break-all text-xs text-muted-foreground">{s.details}</p>}
          <div className="flex flex-wrap gap-1.5">
            {real &&
              real.map((l) => (
                <Badge key={`v-${l}`} variant="success" title={t("Verificado: es una pista de audio real del archivo")}>
                  <BadgeCheck className="size-3" />
                  {streamLangLabel(l)}
                </Badge>
              ))}
            {verifying && (
              <Badge title={t("Revisando las pistas de audio reales del archivo")}>
                <Loader2 className="size-3 animate-spin" />
                {t("Verificando idioma…")}
              </Badge>
            )}
            {!real &&
              s.languages
              .filter((l) => l !== "multi")
              .map((l) => (
                <Badge key={l} variant={l === "latino" || l === "castellano" || l === "espanol" ? "primary" : "default"}>
                  {streamLangLabel(l)}
                </Badge>
              ))}
            {s.subtitleLanguages.length > 0 && (
              <Badge title={t("El audio es el original; estos idiomas son de los subtítulos que trae el archivo")}>
                <Captions className="size-3" />
                {t("Audio original · subs: {langs}", { langs: s.subtitleLanguages.map((l) => streamLangLabel(l)).join(", ") })}
              </Badge>
            )}
            {!real &&
              isMultiAudio(s.languages) &&
              (desktop ? (
                <Badge title={t("Trae varios idiomas: la app elige el de tu perfil y puedes cambiarlo en Idioma")}>
                  {t("Varios idiomas")}
                </Badge>
              ) : (
                <Badge
                  variant="warning"
                  title={t("Trae varios idiomas en un archivo. En el navegador suena el predeterminado, que puede ser el original.")}
                >
                  {t("Multi audio: puede sonar el original")}
                </Badge>
              ))}
            {s.size && (
              <Badge>
                <HardDrive className="size-3" />
                {s.size}
              </Badge>
            )}
            {s.webRisk && !desktop && (
              <Badge variant="warning" title={t("HEVC, HDR o MKV: el navegador podría no reproducirlo (en la app de Android sí)")}>
                <AlertTriangle className="size-3" />
                {t("Puede fallar en navegador")}
              </Badge>
            )}
            {s.audioRisk && !desktop && (
              <Badge variant="warning" title={t("Audio AC3/DTS: Chrome no lo reproduce (en la app de Android sí)")}>
                <VolumeX className="size-3" />
                {t("Audio AC3/DTS: puede no sonar")}
              </Badge>
            )}
            {disabled && (
              <Badge>
                <Lock className="size-3" />
                {t("Torrent: configura el addon con Real-Debrid")}
              </Badge>
            )}
          </div>
        </div>

        <div className="shrink-0 self-center text-muted-foreground">
          {playable ? <Play className="size-5" /> : opensOutside ? <ExternalLink className="size-5" /> : null}
        </div>
      </button>
    </li>
  );
}
