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

// tabindex=-1 = deliberately out of the tab order (carousel arrows…):
// never a remote target either.
const FOCUSABLE = [
  "a[href]:not([tabindex='-1'])",
  "button:not([disabled]):not([tabindex='-1'])",
  "input:not([disabled]):not([type=hidden]):not([tabindex='-1'])",
  "select:not([disabled]):not([tabindex='-1'])",
  "textarea:not([disabled]):not([tabindex='-1'])",
  "[tabindex]:not([tabindex='-1'])",
  "[role=menuitem]",
].join(",");

type WithCheckVisibility = HTMLElement & { checkVisibility?: (o?: { opacityProperty?: boolean; visibilityProperty?: boolean }) => boolean };

/** Cheap first (size), the browser's own check next; getComputedStyle on
 * every poster of a long grid made each press (and held arrows) slow. */
function isVisible(el: HTMLElement) {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (el.closest("[aria-hidden=true], [inert]")) return false;
  const check = (el as WithCheckVisibility).checkVisibility;
  if (check) return check.call(el, { opacityProperty: true, visibilityProperty: true });
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && Number(style.opacity) > 0.05;
}

/** An open modal/menu traps focus; otherwise the whole page. */
function scope(): ParentNode {
  const layers = document.querySelectorAll<HTMLElement>(
    "[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open]",
  );
  return layers.length ? layers[layers.length - 1] : document;
}

/** Everything focusable in scope with its box (one layout pass). The
 * visibility check (the slow part) is left for the few best candidates. */
function boxes(root: ParentNode) {
  const out: { el: HTMLElement; r: DOMRect }[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    const r = el.getBoundingClientRect();
    if (r.width >= 2 && r.height >= 2) out.push({ el, r });
  }
  return out;
}

function candidates(root: ParentNode) {
  return boxes(root)
    .filter(({ el }) => isVisible(el))
    .map(({ el }) => el);
}

/** Closest candidate in a direction: distance along it, heavily penalizing
 * being off to the side (so "down" stays in the same column). */
function score(from: DOMRect, r: DOMRect, dir: Direction): number | null {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  const ex = r.left + r.width / 2;
  const ey = r.top + r.height / 2;
  let along: number;
  let gap: number;
  let offset: number;
  if (dir === "left" || dir === "right") {
    along = dir === "right" ? r.left - from.right : from.left - r.right;
    if ((dir === "right" ? ex - cx : cx - ex) <= 1) return null;
    gap = Math.max(0, Math.max(r.top, from.top) - Math.min(r.bottom, from.bottom));
    // Left/right never jump to another row (end of a row = stay put).
    if (gap > 0) return null;
    offset = Math.abs(ey - cy);
  } else {
    along = dir === "down" ? r.top - from.bottom : from.top - r.bottom;
    if ((dir === "down" ? ey - cy : cy - ey) <= 1) return null;
    gap = Math.max(0, Math.max(r.left, from.left) - Math.min(r.right, from.right));
    offset = Math.abs(ex - cx);
  }
  return Math.max(0, along) + gap * 4 + offset * 0.1;
}

/** Closest visible element in a direction: score every box (cheap), then
 * check visibility in score order and stop at the first visible one. */
function bestIn(from: DOMRect, all: { el: HTMLElement; r: DOMRect }[], dir: Direction, current: HTMLElement | null) {
  const scored: { el: HTMLElement; s: number }[] = [];
  for (const { el, r } of all) {
    if (el === current || (current && (el.contains(current) || current.contains(el)))) continue;
    const s = score(from, r, dir);
    if (s !== null) scored.push({ el, s });
  }
  scored.sort((a, b) => a.s - b.s);
  for (const { el } of scored) if (isVisible(el)) return el;
  return null;
}

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

/** Held arrow: jump without animation (smooth scrolls piled up and lagged). */
function focusEl(el: HTMLElement, instant = false) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: instant ? "auto" : "smooth" });
}

// A held arrow repeats ~30 times a second; one move every this many ms
// keeps it fast but readable.
const REPEAT_MS = 90;
let lastMove = 0;

// Where the focus last was (to resume if that element disappears).
let lastRect: DOMRect | null = null;
let lastPath = "";
// Last thing focused on the page itself (not the top bar): ↓ from the
// top bar goes back there.
let lastOnPage: HTMLElement | null = null;
let lastOnPagePath = "";

// The sticky top bar (logo, menu, search, profile). It's always on screen,
// so by geometry alone ↑ would jump to it from anywhere; it's only reached
// from the top of the page instead.
const TOP_BAR = "[data-nav-top]";

function inTopBar(el: Element) {
  return el.closest(TOP_BAR) !== null;
}

// Per page, the item focused last (its link or source): going back to a
// page puts the focus there again (the poster you opened, the source that
// was playing).
const pageFocus = new Map<string, string>();
const pageKey = () => location.pathname + location.search;
/** What identifies an item across visits: its link, or a source's URL. */
function identity(el: HTMLElement) {
  return el.getAttribute("href") ?? el.dataset.stream ?? null;
}
function findByIdentity(id: string) {
  for (const el of document.querySelectorAll<HTMLElement>("main a[href], main [data-stream]")) {
    if (identity(el) === id && isVisible(el)) return el;
  }
  return null;
}

// Dialogs opened by a plain button (not a Radix trigger) don't know where to
// put the focus back when they close: remember what was focused before.
const LAYER = "[role=dialog], [role=alertdialog], [role=menu]";
let lastOutsideLayer: HTMLElement | null = null;
let opener: HTMLElement | null = null;

/** Focus lost after a dialog/menu closed: back to what opened it. */
function restoreOpener() {
  const active = document.activeElement;
  if (active && active !== document.body && active.isConnected) return false;
  const target = opener;
  opener = null;
  if (!target?.isConnected || !isVisible(target)) return false;
  target.focus({ preventScroll: true });
  return true;
}

function rememberFocus(e: FocusEvent) {
  const el = e.target;
  if (!(el instanceof HTMLElement) || el === document.body) return;
  if (el.closest(LAYER)) {
    if (lastOutsideLayer && !opener) opener = lastOutsideLayer;
  } else {
    lastOutsideLayer = el;
    opener = null;
  }
  lastRect = el.getBoundingClientRect();
  lastPath = location.pathname;
  if (el.closest("main")) {
    lastOnPage = el;
    lastOnPagePath = location.pathname;
    const id = identity(el);
    if (id) pageFocus.set(pageKey(), id);
  }
}

// Set by Back (browser history), read by the next focusPageStart.
let wentBack = false;
// Any key since the page changed: the user is driving, leave the focus be.
let movedSincePageChange = false;

/** Tabs (seasons…): coming in from outside lands on the selected one. */
function preferSelectedTab(next: HTMLElement, current: HTMLElement) {
  const list = next.closest("[role=tablist]");
  if (!list || list.contains(current)) return next;
  const selected = list.querySelector<HTMLElement>("[role=tab][aria-selected=true]");
  return selected && isVisible(selected) ? selected : next;
}

function nearest(from: DOMRect, all: { el: HTMLElement; r: DOMRect }[]) {
  const cx = from.left + from.width / 2;
  const cy = from.top + from.height / 2;
  let winner: HTMLElement | null = null;
  let d = Infinity;
  for (const { el, r } of all) {
    const dist = Math.hypot(r.left + r.width / 2 - cx, r.top + r.height / 2 - cy);
    if (dist < d && isVisible(el)) {
      d = dist;
      winner = el;
    }
  }
  return winner;
}

/** ↓ from the top bar: the last item focused on this page, else the
 * page's first visible item. */
function backToPage(all: { el: HTMLElement; r: DOMRect }[]) {
  if (lastOnPage?.isConnected && lastOnPagePath === location.pathname && isVisible(lastOnPage)) return lastOnPage;
  const page = all.filter(({ el }) => el.closest("main") && isVisible(el)).map(({ el }) => el);
  return page.length ? firstItem(page) : null;
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

/** Touch or mouse on a field (phones, tablets, emulators): type right away.
 * The lock is only for the remote passing through. Runs before the focus,
 * so onFocusIn sees it as "editing" and leaves it unlocked. */
function onPointerDown(e: PointerEvent) {
  const el = e.target instanceof Element ? e.target.closest("input, textarea") : null;
  if (!isTextField(el) || el.disabled) return;
  el.dataset.remoteEditing = "";
  unlockField(el);
}

function onFocusOut(e: FocusEvent) {
  const el = e.target as Element;
  // Focus dropped out of a closing dialog/menu (after its animation): put
  // it back on what opened it.
  if (!e.relatedTarget && el instanceof Element && el.closest(LAYER)) window.setTimeout(restoreOpener, 30);
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

function onPopState() {
  wentBack = true;
}

// --- <select> ------------------------------------------------------------------
// The WebView's own popup for a <select> doesn't take the remote in every
// box (the arrows went on to the page behind it). With the remote, OK opens
// this list instead: arrows move in it, OK picks, Back closes.

/** Set a React-controlled <select> and let React know. */
function setSelectValue(select: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(select, value);
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

function openSelectPicker(select: HTMLSelectElement) {
  const overlay = document.createElement("div");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.dataset.state = "open";
  overlay.className = "fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4";
  const box = document.createElement("div");
  box.className = "flex max-h-[80vh] w-full max-w-sm flex-col gap-1 overflow-y-auto rounded-xl border border-border bg-card p-2 text-foreground shadow-2xl";
  const label = select.getAttribute("aria-label") ?? select.labels?.[0]?.textContent ?? select.closest("label")?.textContent ?? "";
  if (label.trim()) {
    const title = document.createElement("p");
    title.className = "px-3 pb-1 pt-2 text-sm font-semibold text-muted-foreground";
    title.textContent = label.trim();
    box.append(title);
  }
  const close = () => {
    overlay.remove();
    select.focus({ preventScroll: true });
  };
  let selected: HTMLButtonElement | null = null;
  for (const option of select.options) {
    if (option.hidden) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.disabled = option.disabled;
    b.textContent = option.text;
    b.className = `rounded-lg px-3 py-2.5 text-left text-sm hover:bg-muted focus:bg-muted disabled:opacity-40 ${option.selected ? "font-semibold text-primary" : ""}`;
    b.addEventListener("click", () => {
      close();
      if (select.value !== option.value) setSelectValue(select, option.value);
    });
    if (option.selected) selected = b;
    box.append(b);
  }
  overlay.append(box);
  overlay.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    close();
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.body.append(overlay);
  const first = selected ?? box.querySelector<HTMLButtonElement>("button:not([disabled])");
  first?.focus({ preventScroll: true });
  first?.scrollIntoView({ block: "nearest" });
}

/** Capture phase, before the page's own handlers see the key. */
/** An open suggestions list (search box): Back/Escape closes it first. */
function closeOpenCombobox(): boolean {
  const combo = document.querySelector<HTMLElement>("[role=combobox][aria-expanded=true]");
  if (!combo) return false;
  combo.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
  return true;
}

function onKeyDownCapture(e: KeyboardEvent) {
  const active = document.activeElement;
  // Back/Escape with suggestions open: close them (the box handles it).
  if (e.key === "Escape" && e.isTrusted && document.querySelector("[role=combobox][aria-expanded=true]")) {
    e.preventDefault();
    e.stopPropagation();
    closeOpenCombobox();
    return;
  }
  // OK on a <select>: our own list (see openSelectPicker).
  if ((e.key === "Enter" || e.key === "NumpadEnter") && active instanceof HTMLSelectElement && !active.disabled) {
    e.preventDefault();
    e.stopPropagation();
    openSelectPicker(active);
    return;
  }
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
  movedSincePageChange = true;
  const dir = KEYS[e.key];
  if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (active && keepsArrows(active, dir)) return;

  e.preventDefault();
  if (e.repeat && performance.now() - lastMove < REPEAT_MS) return;
  lastMove = performance.now();

  const root = scope();
  const all = boxes(root);
  const current = active && active !== document.body && root.contains(active) && all.some((b) => b.el === active) ? active : null;

  if (!current) {
    // A dialog just closed (saved, cancelled): back to its button.
    if (restoreOpener()) return;
    // The focused thing went away (the page re-rendered, a row loaded):
    // carry on from where it was instead of jumping back to the top.
    const from = lastRect && lastPath === location.pathname ? lastRect : null;
    const resume = from ? bestIn(from, all, dir, null) ?? nearest(from, all) : null;
    const first = resume ?? firstItem(all.filter(({ el }) => isVisible(el)).map(({ el }) => el));
    if (first) focusEl(first, e.repeat);
    return;
  }
  // Search suggestions: a vertical list over the page; sideways would land
  // on something hidden under it.
  if ((dir === "left" || dir === "right") && current.closest("[role=listbox]")) return;
  const currentRect = current.getBoundingClientRect();
  let next: HTMLElement | null;
  if (root === document && (dir === "up" || dir === "down") && inTopBar(current)) {
    // ↓ from the top bar: back to where you were on the page, else its
    // first item (never somewhere halfway down).
    next = dir === "down" ? backToPage(all) : bestIn(currentRect, all, dir, current);
  } else if (root === document && (dir === "up" || dir === "down")) {
    // On the page: up/down stay on it; the top bar only from its top.
    const page = all.filter(({ el }) => !inTopBar(el));
    next = bestIn(currentRect, page, dir, current) ?? (dir === "up" ? bestIn(currentRect, all, dir, current) : null);
  } else {
    next = bestIn(currentRect, all, dir, current);
  }
  if (next) next = preferSelectedTab(next, current);
  if (next) {
    focusEl(next, e.repeat);
  } else if (root === document && (dir === "up" || dir === "down")) {
    // Rows further down may still be loading: bring them in, but never so
    // far that the focused item leaves the screen.
    const room = dir === "down" ? currentRect.top - 80 : window.innerHeight - currentRect.bottom - 80;
    const amount = Math.min(window.innerHeight * 0.6, Math.max(0, room));
    if (amount > 0) window.scrollBy({ top: (dir === "down" ? 1 : -1) * amount, behavior: e.repeat ? "auto" : "smooth" });
  }
}

/** Back button on the remote: stop typing, then close the open
 * menu/dialog, before leaving the page. */
// Screens that answer Back themselves while shown (newest first), e.g.
// the Android player's "Idioma y calidad" list → back to the video.
const backHandlers: (() => boolean)[] = [];

/** Take the remote's Back while mounted; return the function to release it. */
export function onRemoteBack(handler: () => boolean) {
  backHandlers.unshift(handler);
  return () => {
    const i = backHandlers.indexOf(handler);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

function closeLayer(): boolean {
  if (closeOpenCombobox()) return true;
  for (const handler of backHandlers) if (handler()) return true;
  const active = document.activeElement;
  if (isTextField(active) && isEditing(active) && active.dataset.remoteEditing !== undefined) {
    delete active.dataset.remoteEditing;
    lockField(active);
    return true;
  }
  const layer = document.querySelector("[role=dialog][data-state=open], [role=alertdialog][data-state=open], [role=menu][data-state=open]");
  if (layer) {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    return true;
  }
  return backToTop();
}

/** Back deep down a page (like TV apps): first back to the top, where the
 * menu is; Back again leaves the page. */
function backToTop(): boolean {
  if (!remoteMode() || window.scrollY < window.innerHeight * 0.75) return false;
  const active = document.activeElement;
  if (active && active !== document.body && !active.closest("main")) return false;
  window.scrollTo({ top: 0, behavior: "auto" });
  const first = firstItem(candidates(document).filter((el) => el.closest("main")));
  if (first) first.focus({ preventScroll: true });
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
// The page's content often arrives after the page itself (catalogs load):
// wait for it a little rather than settling on the top bar.
const START_TRIES = 12;
const START_EVERY_MS = 300;
let startTimer = 0;

/** The page's main action, marked with data-remote-start (the element, or
 * the first focusable thing inside it). */
function pageStartTarget() {
  const mark = document.querySelector<HTMLElement>("main [data-remote-start]");
  if (!mark) return null;
  if (mark.matches(FOCUSABLE) && isVisible(mark)) return mark;
  return [...mark.querySelectorAll<HTMLElement>(FOCUSABLE)].find(isVisible) ?? null;
}

function focusAndShow(el: HTMLElement) {
  el.focus({ preventScroll: true });
  el.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
}

export function focusPageStart() {
  if (!remoteMode()) return;
  window.clearTimeout(startTimer);
  movedSincePageChange = false;
  // Back to a page: the item you left it from (read before anything here
  // gets focused and overwrites it).
  const restore = wentBack ? pageFocus.get(pageKey()) : undefined;
  wentBack = false;
  let tries = 0;
  let settled = false; // something of the page got the focus
  const attempt = () => {
    if (movedSincePageChange) return;
    // Content arrives late (catalogs, sources): keep looking for the best
    // target a few seconds, until the remote is used.
    const preferred = (restore ? findByIdentity(restore) : null) ?? pageStartTarget();
    if (preferred) {
      if (document.activeElement !== preferred) focusAndShow(preferred);
      return;
    }
    const active = document.activeElement;
    const hasFocus = active && active !== document.body && active.isConnected;
    if (!settled && !hasFocus) {
      const list = candidates(scope());
      // Loading placeholders don't count as the page's start.
      const ready = list.filter((el) => el.closest("main") && !el.closest("[aria-busy=true]"));
      if (ready.length || tries >= START_TRIES - 1) {
        const first = firstItem(ready.length ? ready : list);
        if (first) first.focus({ preventScroll: true });
        settled = Boolean(first);
      }
    }
    if (++tries < START_TRIES) startTimer = window.setTimeout(attempt, START_EVERY_MS);
  };
  startTimer = window.setTimeout(attempt, 350);
}

export function installSpatialNavigation() {
  document.documentElement.dataset.remote = "";
  window.addEventListener("keydown", onKeyDownCapture, true);
  window.addEventListener("keydown", onKeyDown);
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("focusin", rememberFocus);
  document.addEventListener("focusout", onFocusOut);
  window.addEventListener("popstate", onPopState);
  window.__aetherBack = closeLayer;
  return () => {
    window.removeEventListener("popstate", onPopState);
    delete document.documentElement.dataset.remote;
    window.removeEventListener("keydown", onKeyDownCapture, true);
    window.removeEventListener("keydown", onKeyDown);
    document.removeEventListener("focusin", onFocusIn);
  document.removeEventListener("focusin", rememberFocus);
    document.removeEventListener("focusout", onFocusOut);
    document.removeEventListener("pointerdown", onPointerDown, true);
    delete window.__aetherBack;
  };
}

// Exported for tests.
export const _internal = { best };
