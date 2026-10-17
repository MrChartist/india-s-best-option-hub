/**
 * Rule-based alerts, split in two:
 *
 * - AlertRunner: always mounted and light. Polls the chains the enabled rules need (FlowFeeder)
 *   and evaluates every rule (hooks/useAlertEngine). No UI.
 * - AlertSheet: the quick panel, lazy-loaded the first time it is opened. Full management lives on
 *   the Alerts page (/alerts).
 *
 * Works controlled (open/onOpenChange, as DashboardLayout uses it) or with no props, in which case
 * it renders its own bell button.
 */
import { Suspense, useState, useSyncExternalStore } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FlowFeeder } from "@/components/flow/FlowFeeder";
import { useAlertRunner } from "@/hooks/useAlertEngine";
import { alertStore } from "@/lib/alerts";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const AlertSheet = lazyWithRetry(() => import("@/components/alerts/AlertSheet"));

/** Feeds plus evaluation. Renders nothing visible. */
function AlertRunner() {
  const { feedSymbols } = useAlertRunner();
  return (
    <>
      {feedSymbols.map((s) => (
        <FlowFeeder key={s} symbol={s} />
      ))}
    </>
  );
}

function activeCount(): number {
  return alertStore.getState().rules.reduce((n, r) => n + (r.enabled ? 1 : 0), 0);
}

interface AlertSystemProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function AlertSystem({ open, onOpenChange }: AlertSystemProps = {}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const controlled = open !== undefined;
  const isOpen = controlled ? open : innerOpen;
  // Mount the sheet chunk on first open, then keep it mounted so closing animates.
  const [loaded, setLoaded] = useState(isOpen);
  if (isOpen && !loaded) setLoaded(true);
  const active = useSyncExternalStore(alertStore.subscribe, activeCount, activeCount);

  const setOpen = (o: boolean) => {
    if (!controlled) setInnerOpen(o);
    onOpenChange?.(o);
  };

  return (
    <>
      <AlertRunner />
      {!controlled ? (
        <Button
          variant="ghost"
          size="icon"
          className="relative h-8 w-8"
          onClick={() => setOpen(true)}
          aria-label={`Alerts, ${active} active`}
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
          {active > 0 ? (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-capsule bg-primary px-1 text-micro text-primary-foreground"
              aria-hidden="true"
            >
              {active}
            </span>
          ) : null}
        </Button>
      ) : null}
      {loaded ? (
        <Suspense fallback={null}>
          <AlertSheet open={isOpen} onOpenChange={setOpen} />
        </Suspense>
      ) : null}
    </>
  );
}

export default AlertSystem;
