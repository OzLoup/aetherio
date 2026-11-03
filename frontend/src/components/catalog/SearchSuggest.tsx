import { Film, Search as SearchIcon, Tv } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import { API_BASE_URL } from "@/api/client";
import { Input } from "@/components/ui/input";
import { useProfiles } from "@/context/ProfileContext";
import { detailPath } from "@/lib/routes";
import { remoteMode } from "@/lib/spatialNav";
import { hideAdult, type MetaPreview } from "@/lib/stremio";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

const DEBOUNCE_MS = 250;
const MIN_CHARS = 2;

interface SearchSuggestProps {
  value: string;
  onChange: (value: string) => void;
  /** Enter / "Ver todos los resultados": the full search. */
  onSubmit: (query: string) => void;
  className?: string;
  inputClassName?: string;
  iconClassName?: string;
  placeholder?: string;
  autoFocus?: boolean;
}

/** Search box with suggestions while typing (movies and series from the
 * own catalogs' TMDB search). Picking one opens its page; Enter or "Ver
 * todos los resultados" runs the full search across addons. Without the
 * own catalogs (no TMDB key) it's a plain search box. */
export function SearchSuggest({ value, onChange, onSubmit, className, inputClassName, iconClassName, placeholder, autoFocus }: SearchSuggestProps) {
  const navigate = useNavigate();
  const { current } = useProfiles();
  const language = current?.language ?? "es-419";
  const listId = useId();
  const [items, setItems] = useState<MetaPreview[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  // Typed by the person (not set from the URL), so the list may open.
  const typed = useRef(false);

  useEffect(() => {
    const query = value.trim();
    // (Too short or not typed: the list just doesn't show, see showList.)
    if (!typed.current || query.length < MIN_CHARS) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`${API_BASE_URL}/stremio/tmdb/suggest.json?${new URLSearchParams({ q: query, lang: language })}`, { signal: controller.signal })
        .then((r) => (r.ok ? r.json() : { metas: [] }))
        .then((d: { metas?: MetaPreview[] }) => {
          setItems((d.metas ?? []).filter((m) => !hideAdult.meta(m)));
          setHighlight(-1);
        })
        .catch(() => {});
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value, language]);

  // Click/tap outside closes the list.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  const showList = open && items.length > 0 && value.trim().length >= MIN_CHARS;

  function pick(m: MetaPreview) {
    setOpen(false);
    typed.current = false;
    navigate(detailPath(m.type, m.id));
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const query = value.trim();
    if (highlight >= 0 && items[highlight]) return pick(items[highlight]);
    setOpen(false);
    if (query) onSubmit(query);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && showList) {
      e.preventDefault();
      setOpen(false);
      return;
    }
    // TV remote: the arrows move focus into the list (lib/spatialNav).
    if (!showList || remoteMode()) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const last = items.length; // the "Ver todos" row
      setHighlight((h) => (e.key === "ArrowDown" ? (h >= last ? -1 : h + 1) : h <= -1 ? last : h - 1));
    }
  }

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <form onSubmit={submit} role="search">
        <SearchIcon className={cn("pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground", iconClassName)} />
        <Input
          type="search"
          value={value}
          onChange={(e) => {
            typed.current = true;
            onChange(e.target.value);
            setOpen(true);
          }}
          onFocus={() => typed.current && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? t("Buscar")}
          className={cn("pl-8", inputClassName)}
          aria-label={t("Buscar")}
          autoFocus={autoFocus}
          autoComplete="off"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && highlight >= 0 ? `${listId}-${highlight}` : undefined}
        />
      </form>
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-[70vh] min-w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {items.map((m, i) => (
            <li key={`${m.type}:${m.id}`} role="option" id={`${listId}-${i}`} aria-selected={highlight === i}>
              <button
                type="button"
                onClick={() => pick(m)}
                onMouseEnter={() => setHighlight(i)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-sm focus-visible:outline-none",
                  highlight === i ? "bg-muted" : "hover:bg-muted focus:bg-muted",
                )}
              >
                <span className="flex h-12 w-8 shrink-0 items-center justify-center overflow-hidden rounded bg-muted">
                  {m.poster ? (
                    <img src={m.poster} alt="" loading="lazy" className="size-full object-cover" />
                  ) : m.type === "series" ? (
                    <Tv className="size-4 text-muted-foreground" />
                  ) : (
                    <Film className="size-4 text-muted-foreground" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[m.type === "series" ? t("Serie") : t("Película"), m.releaseInfo].filter(Boolean).join(" · ")}
                  </span>
                </span>
              </button>
            </li>
          ))}
          <li role="option" id={`${listId}-${items.length}`} aria-selected={highlight === items.length}>
            <button
              type="button"
              onClick={() => {
                setHighlight(-1);
                setOpen(false);
                onSubmit(value.trim());
              }}
              onMouseEnter={() => setHighlight(items.length)}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-primary focus-visible:outline-none",
                highlight === items.length ? "bg-muted" : "hover:bg-muted focus:bg-muted",
              )}
            >
              <SearchIcon className="size-4" />
              {t("Ver todos los resultados de “{query}”", { query: value.trim() })}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
}
