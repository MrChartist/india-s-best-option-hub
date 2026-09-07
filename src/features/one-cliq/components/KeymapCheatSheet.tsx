import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { KEYMAP, chordLabel, type KeyBinding } from "../lib/keymap";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GROUP_ORDER: KeyBinding["group"][] = ["Execute", "Select", "Manage", "Safety", "Help"];

const GROUP_NOTE: Partial<Record<KeyBinding["group"], string>> = {
  Execute: "Only fire while the terminal is ARMED (press O).",
  Select: "Always available — these never place an order.",
  Safety: "Close All needs two presses within 2 seconds.",
};

/**
 * The `?` overlay. Rendered from the same KEYMAP the handler uses, so a binding
 * can never be documented differently from how it behaves.
 */
export function KeymapCheatSheet({ open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Active only on this page. Typing in a field or opening a dialog suspends them.
          </DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-2 gap-4">
          {GROUP_ORDER.map((group) => {
            const bindings = KEYMAP.filter((b) => b.group === group);
            if (bindings.length === 0) return null;
            return (
              <section key={group}>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{group}</h3>
                {GROUP_NOTE[group] && (
                  <p className="text-[11px] text-muted-foreground mb-1.5">{GROUP_NOTE[group]}</p>
                )}
                <ul className="space-y-1">
                  {bindings.map((b) => (
                    <li key={`${b.action}-${b.key}`} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="text-muted-foreground">{b.label}</span>
                      <kbd className="px-1.5 py-0.5 rounded bg-muted font-mono text-[10px] whitespace-nowrap">
                        {chordLabel(b)}
                      </kbd>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
