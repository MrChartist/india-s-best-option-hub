/**
 * "Customise" popover: named workspaces, trader presets (Scalper, Writer, Swing, Expiry), density,
 * section visibility and order, JSON export/import, the context line and the getting-started tour.
 * State lives in src/pages/Index.tsx and persists to localStorage through workspaces.ts.
 */
import { useId, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { ArrowDown, ArrowUp, Check, Copy, Download, Map as MapIcon, Pencil, Plus, RotateCcw, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { istDateString } from "@/lib/options";
import { cn } from "@/lib/utils";
import { DEFAULT_LAYOUT, moveSection, sectionMeta, setSectionVisible, type Density } from "./dashboardModel";
import {
  MAX_NAME,
  MAX_WORKSPACES,
  PRESETS,
  activeWorkspace,
  addWorkspace,
  applyPreset,
  deleteWorkspace,
  exportWorkspaces,
  importWorkspaces,
  matchingPreset,
  renameWorkspace,
  switchWorkspace,
  updateActiveLayout,
  type WorkspaceState,
} from "./workspaces";

interface Props {
  state: WorkspaceState;
  onChange: (fn: (s: WorkspaceState) => WorkspaceState) => void;
  showContext: boolean;
  onShowContext: (v: boolean) => void;
  onRestartTour: () => void;
  /** False when localStorage refused the last save. */
  saved?: boolean;
}

const iconBtn =
  "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:shadow-ember focus-visible:outline-none";
const smallBtn =
  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-body-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40 focus-visible:shadow-ember focus-visible:outline-none";

function DensityToggle({ value, onChange }: { value: Density; onChange: (d: Density) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next: Density = value === "compact" ? "comfortable" : "compact";
    onChange(next);
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>(`[data-density="${next}"]`)?.focus());
  };
  return (
    <div ref={ref} role="radiogroup" aria-label="Density" className="inline-flex h-8 items-center rounded-capsule border border-border bg-muted p-0.5" onKeyDown={onKeyDown}>
      {(["comfortable", "compact"] as const).map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          data-density={d}
          aria-checked={value === d}
          tabIndex={value === d ? 0 : -1}
          onClick={() => onChange(d)}
          className={cn(
            "h-7 rounded-capsule px-2.5 text-body-sm font-medium capitalize transition-colors focus-visible:shadow-ember focus-visible:outline-none",
            value === d ? "bg-card text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {d}
        </button>
      ))}
    </div>
  );
}

function downloadText(filename: string, text: string): boolean {
  try {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

export function LayoutCustomizer({ state, onChange, showContext, onShowContext, onRestartTour, saved = true }: Props) {
  const ws = activeWorkspace(state);
  const layout = ws.layout;
  const hiddenCount = layout.hidden.length;
  const preset = matchingPreset(layout);
  const selectId = useId();
  const [mode, setMode] = useState<null | "new" | "rename">(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [importOpen, setImportOpen] = useState(false);

  const startName = (m: "new" | "rename") => {
    setMode(m);
    setName(m === "rename" ? ws.name : "");
  };
  const submitName = (e: FormEvent) => {
    e.preventDefault();
    if (mode === "new") onChange((s) => addWorkspace(s, name, activeWorkspace(s).layout));
    if (mode === "rename") onChange((s) => renameWorkspace(s, s.activeId, name));
    setNote(mode === "new" ? "Workspace saved." : "Workspace renamed.");
    setMode(null);
  };

  const onExport = () => {
    const ok = downloadText(`mr-chartist-workspaces-${istDateString()}.json`, exportWorkspaces(state));
    setNote(ok ? "Exported all workspaces as JSON." : "Could not start the download in this browser.");
  };
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(exportWorkspaces(state, state.activeId));
      setNote(`Copied “${ws.name}” as JSON.`);
    } catch {
      setNote("Clipboard is blocked in this browser. Use Export instead.");
    }
  };

  return (
    <>
      <Popover
        onOpenChange={(o) => {
          if (o) return;
          setMode(null);
          setNote("");
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-capsule border border-border bg-card px-3 text-body-sm font-medium hover:bg-accent focus-visible:shadow-ember focus-visible:outline-none"
            title="Customise dashboard"
            aria-label={`Customise dashboard. Workspace ${ws.name}${hiddenCount ? `, ${hiddenCount} section${hiddenCount > 1 ? "s" : ""} hidden` : ""}`}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden max-w-[10rem] truncate sm:inline">{state.workspaces.length > 1 ? ws.name : "Customise"}</span>
            {hiddenCount ? <span className="rounded-chip bg-muted px-1 font-num text-micro tabular-nums text-muted-foreground">{hiddenCount}</span> : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="max-h-[min(80vh,640px)] w-[340px] max-w-[calc(100vw-2rem)] overflow-y-auto p-0">
          {/* Workspace */}
          <div className="space-y-2 border-b border-border p-3">
            <div className="flex items-center justify-between">
              <label htmlFor={selectId} className="text-label uppercase text-muted-foreground">
                Workspace
              </label>
              {!saved ? <span className="text-body-sm text-warning">Not saved in this browser</span> : null}
            </div>
            {mode ? (
              <form onSubmit={submitName} className="flex items-center gap-1.5">
                <label htmlFor={`${selectId}-name`} className="sr-only">
                  {mode === "new" ? "New workspace name" : "Workspace name"}
                </label>
                <Input
                  id={`${selectId}-name`}
                  autoFocus
                  value={name}
                  maxLength={MAX_NAME}
                  placeholder={mode === "new" ? "e.g. Monday expiry" : undefined}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Escape") return;
                    e.stopPropagation();
                    setMode(null);
                  }}
                  className="h-8 flex-1"
                />
                <Button type="submit" size="sm" className="h-8">
                  Save
                </Button>
                <Button type="button" size="sm" variant="ghost" className="h-8 px-2" onClick={() => setMode(null)}>
                  Cancel
                </Button>
              </form>
            ) : (
              <div className="flex items-center gap-1">
                <select
                  id={selectId}
                  value={state.activeId}
                  onChange={(e) => onChange((s) => switchWorkspace(s, e.target.value))}
                  className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-body focus-visible:border-primary focus-visible:shadow-ember focus-visible:outline-none"
                >
                  {state.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <button type="button" className={iconBtn} onClick={() => startName("new")} disabled={state.workspaces.length >= MAX_WORKSPACES} aria-label="Save as a new workspace" title={state.workspaces.length >= MAX_WORKSPACES ? `Up to ${MAX_WORKSPACES} workspaces` : "Save as new"}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button type="button" className={iconBtn} onClick={() => startName("rename")} aria-label={`Rename ${ws.name}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={cn(iconBtn, "hover:text-destructive")}
                  disabled={state.workspaces.length <= 1}
                  onClick={() => {
                    if (window.confirm(`Delete the workspace “${ws.name}”?`)) {
                      onChange((s) => deleteWorkspace(s, s.activeId));
                      setNote("Workspace deleted.");
                    }
                  }}
                  aria-label={`Delete ${ws.name}`}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {/* Presets */}
          <div className="space-y-2 border-b border-border p-3">
            <p className="text-label uppercase text-muted-foreground" id={`${selectId}-presets`}>
              Presets
            </p>
            <div className="grid grid-cols-2 gap-1.5" role="group" aria-labelledby={`${selectId}-presets`}>
              {PRESETS.map((p) => {
                const on = preset === p.id;
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    title={p.description}
                    onClick={() => {
                      onChange((s) => applyPreset(s, p.id));
                      setNote(`${p.name} preset applied to “${ws.name}”.`);
                    }}
                    className={cn(
                      "flex min-h-[44px] flex-col items-start rounded-tile border px-2 py-1.5 text-left transition-colors focus-visible:shadow-ember focus-visible:outline-none",
                      on ? "border-primary/60 bg-wash-brand/60" : "border-border hover:bg-accent",
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-1 text-body font-semibold">
                      {p.name}
                      {on ? <Check className="h-3.5 w-3.5 text-primary-ink" aria-hidden="true" /> : null}
                    </span>
                    <span className="line-clamp-2 text-micro text-muted-foreground">{p.description.split(":")[0]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Density */}
          <div className="flex items-center justify-between gap-2 border-b border-border p-3">
            <p className="text-label uppercase text-muted-foreground">Density</p>
            <DensityToggle value={layout.density} onChange={(density) => onChange((s) => updateActiveLayout(s, (l) => ({ ...l, density })))} />
          </div>

          {/* Sections */}
          <div className="border-b border-border p-2">
            <div className="flex items-center justify-between px-1 pb-1">
              <p className="text-label uppercase text-muted-foreground">Sections</p>
              <button
                type="button"
                onClick={() => onChange((s) => updateActiveLayout(s, (l) => ({ ...DEFAULT_LAYOUT, order: [...DEFAULT_LAYOUT.order], density: l.density })))}
                className={smallBtn}
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Reset
              </button>
            </div>
            <ol className="space-y-0.5" aria-label="Dashboard sections in display order">
              {layout.order.map((id, i) => {
                const meta = sectionMeta(id);
                const visible = !layout.hidden.includes(id);
                const switchId = `${selectId}-sec-${id}`;
                return (
                  <li key={id} className={cn("flex items-center gap-2 rounded-md px-1 py-0.5", !visible && "opacity-60")}>
                    <Switch id={switchId} checked={visible} onCheckedChange={(v) => onChange((s) => updateActiveLayout(s, (l) => setSectionVisible(l, id, v)))} aria-label={`Show ${meta.title}`} />
                    <label htmlFor={switchId} className="min-w-0 flex-1 cursor-pointer truncate text-body">
                      {meta.title}
                    </label>
                    <button type="button" className={iconBtn} disabled={i === 0} onClick={() => onChange((s) => updateActiveLayout(s, (l) => moveSection(l, id, -1)))} aria-label={`Move ${meta.title} up`}>
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" className={iconBtn} disabled={i === layout.order.length - 1} onClick={() => onChange((s) => updateActiveLayout(s, (l) => moveSection(l, id, 1)))} aria-label={`Move ${meta.title} down`}>
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>

          {/* Extras */}
          <div className="space-y-2 p-3">
            <div className="flex items-center gap-2">
              <Switch id={`${selectId}-ctx`} checked={showContext} onCheckedChange={onShowContext} aria-label="Show market context line" />
              <label htmlFor={`${selectId}-ctx`} className="cursor-pointer text-body">
                Market context line
              </label>
            </div>
            <div className="flex flex-wrap gap-1">
              <button type="button" className={smallBtn} onClick={onExport}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" /> Export
              </button>
              <button type="button" className={smallBtn} onClick={() => void onCopy()}>
                <Copy className="h-3.5 w-3.5" aria-hidden="true" /> Copy JSON
              </button>
              <button type="button" className={smallBtn} onClick={() => setImportOpen(true)}>
                <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Import
              </button>
              <button type="button" className={smallBtn} onClick={onRestartTour}>
                <MapIcon className="h-3.5 w-3.5" aria-hidden="true" /> Take the tour
              </button>
            </div>
            <p role="status" aria-live="polite" className="min-h-[1.25rem] text-body-sm text-muted-foreground">
              {note}
            </p>
          </div>
        </PopoverContent>
      </Popover>

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImport={(text) => {
          const r = importWorkspaces(state, text);
          if (r.ok) onChange(() => r.state);
          return r;
        }}
      />
    </>
  );
}

function ImportDialog({ open, onOpenChange, onImport }: { open: boolean; onOpenChange: (o: boolean) => void; onImport: (text: string) => ReturnType<typeof importWorkspaces> }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const areaId = useId();

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setText("");
      setError("");
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (f.size > 200_000) {
      setError("That file is too large to be a workspace export.");
      return;
    }
    f.text().then(
      (t) => {
        setText(t);
        setError("");
      },
      () => setError("Could not read that file."),
    );
  };

  const submit = () => {
    const r = onImport(text);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    close(false);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import workspaces</DialogTitle>
          <DialogDescription>Paste JSON exported from this dashboard, or choose a .json file. Imported workspaces are added alongside yours; nothing is overwritten.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <label htmlFor={areaId} className="text-label uppercase text-muted-foreground">
            Workspace JSON
          </label>
          <Textarea
            id={areaId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError("");
            }}
            rows={8}
            spellCheck={false}
            className="font-mono text-body-sm"
            aria-invalid={!!error}
            aria-describedby={error ? `${areaId}-err` : undefined}
            placeholder='{"kind":"mr-chartist/dashboard-workspaces", …}'
          />
          {error ? (
            <p id={`${areaId}-err`} role="alert" className="text-body-sm text-bearish">
              {error}
            </p>
          ) : null}
          <input ref={fileRef} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={onFile} />
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()} className="gap-1.5">
            <Upload className="h-3.5 w-3.5" aria-hidden="true" /> Choose file
          </Button>
          <Button type="button" onClick={submit} disabled={!text.trim()}>
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default LayoutCustomizer;
