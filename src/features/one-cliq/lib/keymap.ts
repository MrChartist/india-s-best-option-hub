/**
 * The terminal keymap — single source of truth.
 *
 * Both the key handler and the on-screen cheat sheet read this, so a binding can
 * never drift from its documentation.
 *
 * Scoping: these are all route-scoped to the terminal and registered on the
 * CAPTURE phase, so they run before the app's global bubble-phase shortcuts
 * (Ctrl+1..8 nav, "/" palette, Alt+A alerts) and stop propagation when handled.
 * Nothing here claims a chord the global map already uses.
 */

export type TerminalAction =
  | "BUY_CALL" | "SELL_CALL" | "BUY_PUT" | "SELL_PUT"
  | "CE_STRIKE_UP" | "CE_STRIKE_DOWN" | "PE_STRIKE_UP" | "PE_STRIKE_DOWN"
  | "LOTS_UP" | "LOTS_DOWN"
  | "QTY_PRESET_1" | "QTY_PRESET_2" | "QTY_PRESET_3" | "QTY_PRESET_4" | "QTY_PRESET_5"
  | "EXPIRY_NEXT" | "EXPIRY_PREV"
  | "EXIT_SELECTED" | "EXIT_25" | "EXIT_50" | "EXIT_75" | "EXIT_100"
  | "CLOSE_ALL" | "CANCEL_ALL"
  | "TOGGLE_ARM" | "DISARM"
  | "TOGGLE_AUTO_SL" | "PLACE_SL"
  | "LIMIT_AT_BID" | "LIMIT_AT_ASK"
  | "SHOW_HELP";

export interface KeyBinding {
  action: TerminalAction;
  /** KeyboardEvent.key, matched case-insensitively for letters. */
  key: string;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
  label: string;
  group: "Execute" | "Select" | "Manage" | "Safety" | "Help";
  /** True when the binding can send an order — only fires while HOT. */
  executes?: boolean;
  /** True when it needs a second press to confirm (see CONFIRM_WINDOW_MS). */
  doubleTap?: boolean;
}

/** A double-tap binding must be pressed twice inside this window. */
export const CONFIRM_WINDOW_MS = 2000;

export const KEYMAP: KeyBinding[] = [
  // ── Execute ── the scalper's core loop, arrow keys as in the reference product
  { action: "BUY_CALL",  key: "ArrowUp",    label: "Buy Call",  group: "Execute", executes: true },
  { action: "SELL_CALL", key: "ArrowDown",  label: "Sell Call", group: "Execute", executes: true },
  { action: "BUY_PUT",   key: "ArrowRight", label: "Buy Put",   group: "Execute", executes: true },
  { action: "SELL_PUT",  key: "ArrowLeft",  label: "Sell Put",  group: "Execute", executes: true },

  // 1Cliq has no limit-order hotkey. These fill that gap. Limits rest on the
  // book rather than executing immediately, so they need no HOT gate.
  { action: "LIMIT_AT_BID", key: "b", label: "Limit at bid", group: "Execute", executes: true },
  { action: "LIMIT_AT_ASK", key: "a", label: "Limit at ask", group: "Execute", executes: true },

  // ── Select ── never place an order, so they work whether HOT or SAFE
  { action: "CE_STRIKE_UP",   key: "ArrowUp",    shift: true, label: "Call strike +1", group: "Select" },
  { action: "CE_STRIKE_DOWN", key: "ArrowDown",  shift: true, label: "Call strike −1", group: "Select" },
  { action: "PE_STRIKE_UP",   key: "ArrowRight", shift: true, label: "Put strike +1",  group: "Select" },
  { action: "PE_STRIKE_DOWN", key: "ArrowLeft",  shift: true, label: "Put strike −1",  group: "Select" },
  { action: "LOTS_UP",   key: "+", label: "Lots +1", group: "Select" },
  { action: "LOTS_DOWN", key: "-", label: "Lots −1", group: "Select" },
  { action: "QTY_PRESET_1", key: "1", label: "Lot preset 1", group: "Select" },
  { action: "QTY_PRESET_2", key: "2", label: "Lot preset 2", group: "Select" },
  { action: "QTY_PRESET_3", key: "3", label: "Lot preset 3", group: "Select" },
  { action: "QTY_PRESET_4", key: "4", label: "Lot preset 4", group: "Select" },
  { action: "QTY_PRESET_5", key: "5", label: "Lot preset 5", group: "Select" },
  { action: "EXPIRY_NEXT", key: "e", label: "Next expiry", group: "Select" },
  { action: "EXPIRY_PREV", key: "e", shift: true, label: "Previous expiry", group: "Select" },

  // ── Manage ──
  { action: "EXIT_SELECTED", key: "x", label: "Exit selected position", group: "Manage", executes: true },
  { action: "EXIT_25",  key: "1", alt: true, label: "Exit 25%",  group: "Manage", executes: true },
  { action: "EXIT_50",  key: "2", alt: true, label: "Exit 50%",  group: "Manage", executes: true },
  { action: "EXIT_75",  key: "3", alt: true, label: "Exit 75%",  group: "Manage", executes: true },
  { action: "EXIT_100", key: "4", alt: true, label: "Exit 100%", group: "Manage", executes: true, doubleTap: true },
  // 1Cliq has no stop-loss hotkey either. This is the second gap filled.
  { action: "TOGGLE_AUTO_SL", key: "s", label: "Arm auto stop-loss", group: "Manage" },
  { action: "PLACE_SL", key: "s", shift: true, label: "Place SL on selection", group: "Manage", executes: true },

  // ── Safety ── F6/F7 match the reference product's on-screen labels.
  // CLOSE_ALL always double-taps: one keypress must never flatten a book.
  // Neither carries `executes` — panic controls must fire whether the
  // terminal is HOT or SAFE (1CLIQ-TRADE-SPEC.md §5: "a lock never blocks
  // getting out of positions"; §6's table never marks F6/F7 "HOT only" the
  // way the arrow keys are). The mouse buttons in ActionBar already work
  // this way — this keeps the keyboard path consistent with them.
  { action: "CLOSE_ALL",  key: "F6", label: "Close all positions (press twice)", group: "Safety", doubleTap: true },
  { action: "CANCEL_ALL", key: "F7", label: "Cancel all orders", group: "Safety" },
  { action: "TOGGLE_ARM", key: "o", label: "Arm / disarm one-click", group: "Safety" },
  { action: "DISARM", key: "Escape", label: "Disarm (never places an order)", group: "Safety" },

  { action: "SHOW_HELP", key: "?", label: "Show this cheat sheet", group: "Help" },
];

function keyMatches(binding: KeyBinding, e: KeyboardEvent): boolean {
  const key = binding.key.length === 1 ? e.key.toLowerCase() : e.key;
  const want = binding.key.length === 1 ? binding.key.toLowerCase() : binding.key;
  if (key !== want) return false;
  // Strict modifier equality: without it, Ctrl+Shift+1 would fire a bare-1
  // binding as well as the global nav shortcut.
  if (!!binding.shift !== e.shiftKey) return false;
  if (!!binding.alt !== e.altKey) return false;
  if (!!binding.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  return true;
}

/**
 * Resolve an event to a binding. Order matters: KEYMAP lists the modified
 * variants after the bare ones, and strict modifier matching keeps them apart.
 */
export function resolveBinding(e: KeyboardEvent): KeyBinding | null {
  for (const binding of KEYMAP) {
    if (keyMatches(binding, e)) return binding;
  }
  return null;
}

/** Human-readable chord, for the cheat sheet and button hints. */
export function chordLabel(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push("Ctrl");
  if (binding.alt) parts.push("Alt");
  if (binding.shift) parts.push("Shift");
  const pretty: Record<string, string> = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc",
  };
  parts.push(pretty[binding.key] || binding.key.toUpperCase());
  return parts.join(" + ");
}
