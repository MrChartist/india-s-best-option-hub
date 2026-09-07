/**
 * "Is the user typing, or is a modal open?"
 *
 * The app's existing global shortcut hook only checks INPUT / TEXTAREA / SELECT.
 * That is not enough here, for two reasons:
 *
 *  1. This codebase uses shadcn/Radix, where a Select is a <button
 *     role="combobox"> and a Command palette input carries [cmdk-input] — none
 *     of which are a SELECT element.
 *  2. These keys place orders. A missed check means an arrow key typed into a
 *     dialog sends a market order behind it.
 *
 * So this errs toward "yes, they are typing" whenever anything modal is open.
 */

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = (target as HTMLElement | null) || (document.activeElement as HTMLElement | null);

  if (el) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
    if (el.isContentEditable) return true;
    if (typeof el.closest === "function") {
      if (el.closest('[contenteditable="true"]')) return true;
      // Radix Select / Combobox triggers are buttons, not SELECT elements.
      if (el.closest('[role="combobox"], [role="listbox"], [role="menu"]')) return true;
      if (el.closest("[cmdk-input], [cmdk-root]")) return true;
    }
  }

  // Any open Radix dialog/alert/popover means the terminal is not in focus, even
  // if focus technically sits on the page behind it.
  if (typeof document !== "undefined") {
    if (document.querySelector('[data-state="open"][role="dialog"]')) return true;
    if (document.querySelector('[role="alertdialog"]')) return true;
    if (document.querySelector("[data-radix-popper-content-wrapper]")) return true;
    // Radix sets this on <body> while a modal holds the scroll lock.
    if (document.body?.hasAttribute("data-scroll-locked")) return true;
  }

  return false;
}
