/**
 * "Customise" popover: show/hide and reorder dashboard sections, toggle the context line,
 * reset to the default layout. State lives in Index.tsx and persists to localStorage.
 */
import { ArrowDown, ArrowUp, RotateCcw, SlidersHorizontal } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { sectionMeta, type DashLayout, type SectionId } from "./dashboardModel";

interface Props {
  layout: DashLayout;
  onMove: (id: SectionId, dir: -1 | 1) => void;
  onToggle: (id: SectionId, visible: boolean) => void;
  onReset: () => void;
  showContext: boolean;
  onShowContext: (v: boolean) => void;
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:shadow-ember focus-visible:outline-none";

export function LayoutCustomizer({ layout, onMove, onToggle, onReset, showContext, onShowContext }: Props) {
  const hiddenCount = layout.hidden.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-8 items-center gap-1.5 rounded-capsule border border-border bg-card px-3 text-body-sm font-medium hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none"
          aria-label={`Customise dashboard${hiddenCount ? `, ${hiddenCount} section${hiddenCount > 1 ? "s" : ""} hidden` : ""}`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden sm:inline">Customise</span>
          {hiddenCount ? <span className="rounded-chip bg-muted px-1 font-num text-micro tabular-nums text-muted-foreground">{hiddenCount}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-2">
        <div className="flex items-center justify-between px-2 pb-1 pt-1">
          <p className="text-label uppercase text-muted-foreground">Sections</p>
          <button type="button" onClick={onReset} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        </div>
        <ol className="max-h-[50vh] space-y-0.5 overflow-y-auto" aria-label="Dashboard sections in display order">
          {layout.order.map((id, i) => {
            const meta = sectionMeta(id);
            const visible = !layout.hidden.includes(id);
            const switchId = `dash-sec-${id}`;
            return (
              <li key={id} className={cn("flex items-center gap-2 rounded-md px-2 py-1", !visible && "opacity-60")}>
                <Switch id={switchId} checked={visible} onCheckedChange={(v) => onToggle(id, v)} aria-label={`Show ${meta.title}`} />
                <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer truncate text-body">
                  {meta.title}
                </label>
                <button type="button" className={iconBtn} disabled={i === 0} onClick={() => onMove(id, -1)} aria-label={`Move ${meta.title} up`}>
                  <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" className={iconBtn} disabled={i === layout.order.length - 1} onClick={() => onMove(id, 1)} aria-label={`Move ${meta.title} down`}>
                  <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ol>
        <div className="mt-1 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2">
          <Switch id="dash-context-line" checked={showContext} onCheckedChange={onShowContext} aria-label="Show market context line" />
          <label htmlFor="dash-context-line" className="cursor-pointer text-body">
            Market context line
          </label>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default LayoutCustomizer;
