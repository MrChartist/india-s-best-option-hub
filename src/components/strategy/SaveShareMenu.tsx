import { useState, type RefObject } from "react";
import { toast } from "sonner";
import { BookmarkPlus, Briefcase, ClipboardCopy, FolderOpen, ImageDown, Images, Link2, Share2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDateIST, formatTimeIST } from "@/lib/options";
import { copyChartPng, exportChartPng } from "./exportPng";
import { deleteSavedStrategy, encodeShare, loadSavedStrategies, saveStrategy, type BuilderLeg, type SavedStrategy, type ShareSource, type ShareState } from "./strategyState";

export interface SaveShareMenuProps {
  legs: BuilderLeg[];
  symbol: string;
  name: string;
  summary: () => string;
  chartRef: RefObject<HTMLDivElement>;
  onLoad: (share: string) => void;
  onAddToPositions: () => void;
  /** Source of the prices on screen; carried in share links and stamped on images. */
  source: ShareSource;
  spot: number;
  /** When re-sharing a shared snapshot, keep its original price time. Defaults to now. */
  pricedAt?: number;
}

const SOURCE_TAG: Record<ShareSource, string | undefined> = { sample: "SAMPLE DATA", delayed: "DELAYED", live: undefined };

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function SaveShareMenu({ legs, symbol, name, summary, chartRef, onLoad, onAddToPositions, source, spot, pricedAt }: SaveShareMenuProps) {
  const [saveOpen, setSaveOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saved, setSaved] = useState<SavedStrategy[]>([]);
  const empty = legs.length === 0;
  const state: ShareState = { symbol, name, legs };

  const shareUrl = () => {
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    url.searchParams.set("s", encodeShare({ ...state, pricedAt: pricedAt ?? Date.now(), source, spot }));
    return url.toString();
  };

  const imageOpts = () => {
    const at = new Date(pricedAt ?? Date.now());
    const legText = legs
      .filter((l) => l.enabled)
      .map((l) => `${l.side === "BUY" ? "B" : "S"} ${l.lots}× ${l.type === "FUT" ? "FUT" : `${l.strike} ${l.type}`} ${formatDateIST(l.expiry)}`)
      .join("  ·  ");
    return {
      title: `${name || "Custom strategy"} · ${symbol}`,
      subtitle: `${legText}  |  Priced ${formatDateIST(at)} ${formatTimeIST(at)}${source === "sample" ? " · sample data" : source === "delayed" ? " · delayed" : " · live"}`,
      tag: SOURCE_TAG[source],
      fileName: `${symbol}-${(name || "strategy").replace(/\s+/g, "-").toLowerCase()}-payoff.png`,
    };
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="secondary">
            <Share2 /> Save & share
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Strategy</DropdownMenuLabel>
          <DropdownMenuItem
            disabled={empty}
            onSelect={() => {
              setSaveName(name || `${symbol} strategy`);
              setSaveOpen(true);
            }}
          >
            <BookmarkPlus aria-hidden="true" /> Save…
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              setSaved(loadSavedStrategies());
              setListOpen(true);
            }}
          >
            <FolderOpen aria-hidden="true" /> Saved strategies
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={empty}
            onSelect={async () => {
              const ok = await copyText(shareUrl());
              if (ok) toast.success("Share link copied", { description: "The link opens a read-only snapshot with these legs and entry prices, stamped with the time and data source." });
              else toast.error("Could not copy the link");
            }}
          >
            <Link2 aria-hidden="true" /> Copy share link
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={empty}
            onSelect={async () => {
              const ok = await copyText(summary());
              if (ok) toast.success("Trade summary copied");
              else toast.error("Could not copy the summary");
            }}
          >
            <ClipboardCopy aria-hidden="true" /> Copy trade summary
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={empty}
            onSelect={async () => {
              const res = await copyChartPng(chartRef.current, imageOpts());
              if (res === "copied") toast.success("Payoff image copied", { description: "Paste it into X, WhatsApp or Telegram." });
              else if (res === "downloaded") toast.message("Image downloaded", { description: "This browser cannot copy images, so the PNG was saved instead." });
              else if (res === "failed") toast.error("Could not create the image", { description: "Your browser blocked it. Try again or take a screenshot." });
            }}
          >
            <Images aria-hidden="true" /> Copy as image
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={empty}
            onSelect={async () => {
              const ok = await exportChartPng(chartRef.current, imageOpts());
              if (!ok) toast.error("PNG export failed", { description: "Your browser blocked the image. Try again or take a screenshot." });
            }}
          >
            <ImageDown aria-hidden="true" /> Download payoff PNG
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={empty} onSelect={onAddToPositions}>
            <Briefcase aria-hidden="true" /> Add to Positions
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save strategy</DialogTitle>
            <DialogDescription>Saved in this browser only. Saving with the same name replaces the old copy.</DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const next = saveStrategy(saveName, state);
              if (next) {
                toast.success("Strategy saved", { description: saveName.trim() || "Untitled strategy" });
                setSaveOpen(false);
              } else {
                toast.error("Could not save", { description: "Browser storage is blocked or full." });
              }
            }}
            className="space-y-3"
          >
            <div className="space-y-1.5">
              <Label htmlFor="sb-save-name">Name</Label>
              <Input id="sb-save-name" value={saveName} onChange={(e) => setSaveName(e.target.value)} maxLength={80} autoFocus />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={listOpen} onOpenChange={setListOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Saved strategies</DialogTitle>
            <DialogDescription>Loading a strategy replaces the current legs. Entry prices are the ones you saved.</DialogDescription>
          </DialogHeader>
          {saved.length === 0 ? (
            <p className="py-6 text-center text-body text-muted-foreground">Nothing saved yet.</p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-separator overflow-y-auto rounded-md border border-separator">
              {saved.map((s) => (
                <li key={s.id} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">{s.name}</p>
                    <p className="text-body-sm text-muted-foreground">
                      {s.symbol} · {formatDateIST(s.savedAt)} {formatTimeIST(s.savedAt)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      onLoad(s.share);
                      setListOpen(false);
                    }}
                  >
                    Load
                  </Button>
                  <Button type="button" size="icon" variant="ghost" className="text-muted-foreground hover:text-bearish" aria-label={`Delete ${s.name}`} onClick={() => setSaved(deleteSavedStrategy(s.id))}>
                    <Trash2 aria-hidden="true" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
