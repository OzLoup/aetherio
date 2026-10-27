/**
 * TV remote navigation (Android app): the arrow keys move focus to the
 * nearest focusable thing in that direction, like a TV home screen, and
 * the focused element is scrolled into view (rows, carousels, grids).
 * Without this the WebView's own focus logic jumps around unpredictably.
 *
 * Rules:
 * - Inside an open dialog or menu, focus stays in it (Radix menus handle
 *   their own arrows; we step aside when an event was already handled).
 * - Text fields keep left/right for the cursor; sliders keep left/right.
 * - Nothing focused yet → the first visible item of the page.
 * - Nothing further that way → scroll a bit (lazy rows load as they appear).
 */

type Direction = "up" | "down" | "left" | "right";

const KEYS: Record<string, Direction> = {
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
};

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
  "[role=menuitem]",
].join(",");

function isVisible(el: HTMLElement) {
  if (el.closest("[aria-hidden=true], [inert]")) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0.05;
}

/** An open modal/menu traps focus; otherwise the whole page. */
function scope(): ParentNode {
  const layers = document.querySelectorAll<HTMLElement>(
    "[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open]",
  );
  return layers.length ? layers[layers.length - 1] : document;
}

function candidates(root: ParentNode) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(isVisible);
}

/** Closest candidate in a direction: distance along it, heavily penalizing
 * being off to the side (so "down" stays in the same column). */
function best(from: DOMRect, list: HTMLElement[], dir: Direction, current: HTMLElement | null) {
  let winner: HTMLElement | null = null;
  let winnerScore = Infinity;
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  for (const el of list) {
    if (el === current || (current && (el.contains(current) || current.contains(el)))) continue;
    const r = el.getBoundingClientRect();
    const ex = r.left + r.width / 2;
    const ey = r.top + r.height / 2;
    let along: number;
    let gap: number;
    let offset: number;
    if (dir === "left" || dir === "right") {
      along = dir === "right" ? r.left - from.right : from.left - r.right;
      if ((dir === "right" ? ex - cx : cx - ex) <= 1) continue;
      gap = Math.max(0, Math.max(r.top, from.top) - Math.min(r.bottom, from.bottom));
      // Left/right never jump to another row (end of a row = stay put).
      if (gap > 0) continue;
      offset = Math.abs(ey - cy);
    } else {
      along = dir === "down" ? r.top - from.bottom : from.top - r.bottom;
      if ((dir === "down" ? ey - cy : cy - ey) <= 1) continue;
      gap = Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right));
      offset = Math.abs(ex - cx);
    }
    const score = Math.max(0, along) + gap * 4 + offset * 0.1;
    if (score < winnerScore) {
      winnerScore = score;
      winner = el;
    }
  }
  return winner;
}

function focusEl(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
}

/** First thing to focus on a page: top-most, left-most visible item (main content first). */
function firstItem(list: HTMLElement[]) {
  const inView = list.filter((el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight;
  });
  const main = inView.filter((el) => el.closest("main"));
  const pool = main.length ? main : inView.length ? inView : list;
  return pool.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return Math.round(ra.top - rb.top) || ra.left - rb.left;
  })[0];
}

function keepsArrows(el: HTMLElement, dir: Direction) {
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    if (el.type === "range") return dir === "left" || dir === "right";
    const text = ["text", "search", "email", "password", "url", "tel", "number", ""].includes(el.type);
    return text && (dir === "left" || dir === "right");
  }
  return false;
}

function onKeyDown(e: KeyboardEvent) {
  const dir = KEYS[e.key];
  if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (active && keepsArrows(active, dir)) return;

  const root = scope();
  const list = candidates(root);
  const current = active && active !== document.body && list.includes(active) ? active : null;
  e.preventDefault();

  if (!current) {
    const first = firstItem(list);
    if (first) focusEl(first);
    return;
  }
  const next = best(current.getBoundingClientRect(), list, dir, current);
  if (next) {
    focusEl(next);
  } else if (root === document && (dir === "up" || dir === "down")) {
    // Rows further down may still be loading: scroll to bring them in.
    window.scrollBy({ top: (dir === "down" ? 1 : -1) * window.innerHeight * 0.6, behavior: "smooth" });
  }
}

/** Back button on the remote: close the open menu/dialog first. */
function closeLayer(): boolean {
  const layer = document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open]");
  if (!layer) return false;
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  return true;
}

declare global {
  interface Window {
    /** Called by the Android app on Back: true = handled here. */
    __aetherBack?: () => boolean;
  }
}

export function installSpatialNavigation() {
  document.documentElement.dataset.remote = "";
  window.addEventListener("keydown", onKeyDown);
  window.__aetherBack = closeLayer;
  return () => {
    delete document.documentElement.dataset.remote;
    window.removeEventListener("keydown", onKeyDown);
    delete window.__aetherBack;
  };
}

// Exported for tests.
export const _internal = { best };
