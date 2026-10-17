import { useCallback, useRef } from "react";

/**
 * Callback ref for a scroll container: while its content overflows, the element gets
 * tabIndex=0 so keyboard users can focus it and scroll with the arrow keys
 * (WCAG 2.1.1, axe "scrollable-region-focusable"). When nothing overflows it stays out
 * of the tab order, so non-scrolling tables add no extra tab stops.
 */
export function useScrollFocusable<T extends HTMLElement = HTMLDivElement>(): (el: T | null) => void {
  const cleanup = useRef<(() => void) | null>(null);
  return useCallback((el: T | null) => {
    cleanup.current?.();
    cleanup.current = null;
    if (!el) return;
    const update = () => {
      const scrollable = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
      if (scrollable) {
        if (el.getAttribute("tabindex") !== "0") el.setAttribute("tabindex", "0");
      } else if (el.getAttribute("tabindex") === "0") {
        el.removeAttribute("tabindex");
      }
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    cleanup.current = () => ro.disconnect();
  }, []);
}
