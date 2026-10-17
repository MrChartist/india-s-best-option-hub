import { useEffect, useState } from "react";

/** Current time, refreshed every `everyMs` (aligned to the next boundary) and when the tab becomes visible. */
export function useNow(everyMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = everyMs - (Date.now() % everyMs) + 50;
      timer = setTimeout(() => {
        setNow(new Date());
        schedule();
      }, delay);
    };
    schedule();
    const onVis = () => {
      if (document.visibilityState === "visible") setNow(new Date());
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [everyMs]);
  return now;
}
