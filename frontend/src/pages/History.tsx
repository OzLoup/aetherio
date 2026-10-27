import { Check, Film, History as HistoryIcon, Loader2, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { deleteFromHistory, getHistory, type ProgressEntry } from "@/api/progress";
import { Button } from "@/components/ui/button";
import { episodeCode, progressShare } from "@/lib/episodes";
import { formatTime } from "@/lib/format";
import { detailPath } from "@/lib/routes";
import { locale, t } from "@/i18n";

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return t("Hoy");
  if (d.toDateString() === yesterday.toDateString()) return t("Ayer");
  return d.toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
}

/** Everything this profile watched or started, newest first, by day. */
export default function History() {
  const [entries, setEntries] = useState<ProgressEntry[] | null>(null);

  useEffect(() => {
    getHistory()
      .then(setEntries)
      .catch(() => setEntries([]));
  }, []);

  async function remove(videoId: string) {
    setEntries((prev) => prev?.filter((e) => e.video_id !== videoId) ?? null);
    await deleteFromHistory(videoId).catch(() => {});
  }

  if (!entries) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const groups: { day: string; items: ProgressEntry[] }[] = [];
  for (const e of entries) {
    const day = dayLabel(e.updated_at);
    if (groups.at(-1)?.day !== day) groups.push({ day, items: [] });
    groups.at(-1)!.items.push(e);
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">{t("Historial")}</h1>
      {entries.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <HistoryIcon className="size-8 text-muted-foreground" />
          <p className="font-medium">{t("Todavía no has visto nada con este perfil")}</p>
          <p className="text-sm text-muted-foreground">{t("Lo que veas aparecerá aquí, en todos tus dispositivos.")}</p>
        </div>
      ) : (
        groups.map((g) => (
          <section key={g.day} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold capitalize text-muted-foreground">{g.day}</h2>
            <ul className="flex flex-col gap-1">
              {g.items.map((e) => {
                const share = e.watched ? 1 : progressShare(e);
                return (
                  <li key={e.video_id} className="flex items-center gap-2">
                    <Link
                      to={detailPath(e.type, e.meta_id)}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <div className="relative h-16 w-11 shrink-0 overflow-hidden rounded bg-muted">
                        {e.poster ? (
                          <img src={e.poster} alt="" loading="lazy" className="size-full object-cover" />
                        ) : (
                          <Film className="m-auto mt-5 size-5 text-muted-foreground" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{e.name}</p>
                        <p className="truncate text-sm text-muted-foreground">
                          {[episodeCode(e.season, e.episode), e.episode_title].filter(Boolean).join(" · ") ||
                            (e.type === "movie" ? t("Película") : "")}
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          {e.watched ? (
                            <span className="flex items-center gap-1 text-primary">
                              <Check className="size-3.5" /> Visto
                            </span>
                          ) : (
                            <>
                              <span className="h-1 w-24 overflow-hidden rounded-full bg-muted">
                                <span className="block h-full bg-primary" style={{ width: `${share * 100}%` }} />
                              </span>
                              {formatTime(e.position)} / {formatTime(e.duration)}
                            </>
                          )}
                        </div>
                      </div>
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => remove(e.video_id)}
                      aria-label={t("Quitar {name} del historial", { name: e.name })}
                      title={t("Quitar del historial")}
                    >
                      <Trash2 />
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
