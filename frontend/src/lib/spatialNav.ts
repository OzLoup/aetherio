/**
 * TV remote navigation (Android app): the arrow keys move focus to the
 * nearest focusable thing in that direction, like a TV home screen, and
 * the focused element is scrolled into view (rows, carousels, grids).
 * Without this the WebView's own focus logic jumps around unpredictably.
 *
 * Rules:
 * - Inside an open dialog or menu, focus stays in it (Radix menus handle
 *   their own arrows; we step aside when an event was already handled).
 * - Text fields are passed through like buttons: landing on one doesn't
 *   open the on-screen keyboard. OK starts typing (then left/right move
 *   the cursor); up/down or Back leave it.
 * - Menu buttons (profile, addon "⋯") open with OK only, not with an arrow.
 * - Sliders keep left/right.
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

const TEXT_TYPES = ["text", "search", "email", "password", "url", "tel", "number", ""];

function isTextField(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && TEXT_TYPES.includes(el.type));
}

// --- text fields: focus ≠ typing -----------------------------------------------
// A focused, editable field opens the TV's keyboard, so fields are kept
// read-only while just passing through and unlocked with OK.

const LOCK = "remoteLock";

function lockField(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el.readOnly || el.dataset[LOCK] !== undefined) return;
  el.dataset[LOCK] = "";
  el.readOnly = true;
}

function unlockField(el: HTMLInputElement | HTMLTextAreaElement) {
  if (el.dataset[LOCK] === undefined) return;
  delete el.dataset[LOCK];
  el.readOnly = false;
}

function isEditing(el: Element | null) {
  return isTextField(el) && !el.readOnly;
}

// Set while startEditing re-focuses the field, so focus handlers leave it be.
let refocusing = false;

/** OK on a locked field: start typing (re-focus so the keyboard shows). */
function startEditing(el: HTMLInputElement | HTMLTextAreaElement) {
  unlockField(el);
  el.dataset.remoteEditing = "";
  refocusing = true;
  el.blur();
  el.focus({ preventScroll: true });
  refocusing = false;
  const end = el.value.length;
  try {
    el.setSelectionRange(end, end);
  } catch {
    // number/email fields don't support selection
  }
}

function onFocusIn(e: FocusEvent) {
  const el = e.target as Element;
  // Landing on a field (arrows, autoFocus, page change) only selects it.
  if (!refocusing && isTextField(el) && el.dataset.remoteEditing === undefined) lockField(el);
}

function onFocusOut(e: FocusEvent) {
  const el = e.target as Element;
  if (refocusing || !isTextField(el)) return;
  // Leaving: the next visit starts locked again; meanwhile the field is
  // as the page made it (mouse/touch keep working).
  delete el.dataset.remoteEditing;
  unlockField(el);
}

function keepsArrows(el: HTMLElement, dir: Direction) {
  const sideways = dir === "left" || dir === "right";
  if (el instanceof HTMLInputElement && el.type === "range") return sideways;
  // Typing: left/right move the cursor; up/down leave the field.
  if (isEditing(el)) return el instanceof HTMLTextAreaElement || sideways;
  return false;
}

/** Closed menu/listbox button: arrows must move focus, not open it. */
function isClosedPopupTrigger(el: Element | null) {
  if (!(el instanceof HTMLElement)) return false;
  const popup = el.getAttribute("aria-haspopup");
  return Boolean(popup && popup !== "false") && el.getAttribute("aria-expanded") !== "true";
}

/** Capture phase, before the page's own handlers see the key. */
function onKeyDownCapture(e: KeyboardEvent) {
  const active = document.activeElement;
  // OK on a field that's only focused: start typing (and don't submit).
  if ((e.key === "Enter" || e.key === "NumpadEnter") && isTextField(active) && active.dataset[LOCK] !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    startEditing(active);
    return;
  }
  // Typing and pressing Back/Escape: stop typing, stay on the field.
  if (e.key === "Escape" && isTextField(active) && isEditing(active) && active.dataset.remoteEditing !== undefined) {
    e.preventDefault();
    e.stopPropagation();
    delete active.dataset.remoteEditing;
    lockField(active);
    return;
  }
  // Menu buttons open on ArrowDown in Radix: here arrows just move on.
  if (KEYS[e.key] && isClosedPopupTrigger(active)) {
    e.stopPropagation();
    onKeyDown(e);
  }
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

/** Back button on the remote: stop typing, then close the open
 * menu/dialog, before leaving the page. */
function closeLayer(): boolean {
  const active = document.activeElement;
  if (isTextField(active) && isEditing(active) && active.dataset.remoteEditing !== undefined) {
    delete active.dataset.remoteEditing;
    lockField(active);
    return true;
  }
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

export function remoteMode() {
  return document.documentElement.dataset.remote !== undefined;
}

/** After a page change: put focus on the page's first item, so the first
 * press of the remote already moves (focus was on something now gone). */
export function focusPageStart() {
  if (!remoteMode()) return;
  window.setTimeout(() => {
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const first = firstItem(candidates(scope()));
    if (first) first.focus({ preventScroll: true });
  }, 350);
}

export function installSpatialNavigation() {
  document.documentElement.dataset.remote = "";
  window.addEventListener("keydown", onKeyDownCapture, true);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  window.__aetherBack = closeLayer;
  return () => {
    delete document.documentElement.dataset.remote;
    window.removeEventListener("keydown", onKeyDownCapture, true);
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
    delete window.__aetherBack;
  };
}

// Exported for tests.
export const _internal = { best };
