import { useEffect } from "react";
import { APP_NAME } from "@/lib/routes";

export const DEFAULT_DOCUMENT_TITLE = "Mr. Chartist Options Terminal";

/** "Option Chain" → "Option Chain · Mr. Chartist"; empty → the default app title. */
export function formatDocumentTitle(title: string): string {
  const t = title.trim();
  return t ? `${t} · ${APP_NAME}` : DEFAULT_DOCUMENT_TITLE;
}

/**
 * Set document.title for the current page, appending " · Mr. Chartist".
 * The previous title is restored on unmount.
 */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const previous = document.title;
    document.title = formatDocumentTitle(title);
    return () => {
      document.title = previous;
    };
  }, [title]);
}
