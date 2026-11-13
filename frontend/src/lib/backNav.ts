import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { setPageBack } from "@/lib/spatialNav";

/** Back that follows the title, not the whole browsing history.
 *
 * The browser's history holds everything visited (a title, then a similar
 * one, episode after episode…), so a plain "back" walks through all of it.
 * Here the player and the source list go back to their title's page, and
 * the title's page goes back to the list it was opened from (Home,
 * Discover, search…). Entries are told apart by their place in the history
 * (react-router numbers them), and we jump straight to the right one. */

type Kind = "page" | "detail" | "flow"; // flow: sources list and player

const kinds = new Map<number, Kind>();

function kindOf(pathname: string): Kind {
  if (pathname.startsWith("/detail/")) return "detail";
  if (pathname.startsWith("/streams/") || pathname.startsWith("/play/")) return "flow";
  return "page";
}

function position(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
}

/** Remember what kind of page each history entry is. Mount once, inside the router. */
export function useTrackNavigation() {
  const { pathname } = useLocation();
  useEffect(() => trackEntry(pathname), [pathname]);
}

export function trackEntry(pathname: string) {
  const idx = position();
  if (idx !== null) kinds.set(idx, kindOf(pathname));
}

/** Steps back to the closest earlier entry of one of these kinds (null: none known). */
export function stepsBackTo(wanted: Kind[]): number | null {
  const here = position();
  if (here === null) return null;
  for (let i = here - 1; i >= 0; i--) {
    const kind = kinds.get(i);
    if (kind === undefined) return null; // a gap (reload): don't guess
    if (wanted.includes(kind)) return here - i;
  }
  return null;
}

/** Leave the player or the sources list: to the title's page, else the previous one.
 * Also what the TV remote's Back does on that page. */
export function useLeaveFlow(): () => void {
  const navigate = useNavigate();
  const leave = useCallback(() => goBack(navigate, ["detail", "page"]), [navigate]);
  useEffect(() => setPageBack(leave), [leave]);
  return leave;
}

/** Leave a title's page: to the list it was opened from, else Home. */
export function useLeaveDetail(): () => void {
  const navigate = useNavigate();
  const leave = useCallback(() => goBack(navigate, ["page"], "/"), [navigate]);
  useEffect(() => setPageBack(leave), [leave]);
  return leave;
}

function goBack(navigate: NavigateFunction, wanted: Kind[], fallback?: string) {
  const steps = stepsBackTo(wanted);
  if (steps !== null) navigate(-steps);
  else if (fallback && position() === 0) navigate(fallback, { replace: true });
  else navigate(-1);
}
