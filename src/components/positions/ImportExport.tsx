/** Export positions as JSON and import (validated, merged with what is already here). */
import { useRef } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { exportPositions, importPositions, type ClosedPosition, type TrackedPosition } from "@/lib/positionStore";
import { istDateString } from "@/lib/options";
import { downloadText } from "./helpers";

export function ImportExport({ onImported, disabled }: { onImported: (r: { active: TrackedPosition[]; closed: ClosedPosition[] }) => void; disabled?: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = importPositions(String(reader.result ?? ""));
      if (res.error) {
        toast.error("Import failed", { description: res.error });
        return;
      }
      onImported({ active: res.active, closed: res.closed });
      const parts = [`${res.addedActive} open`, `${res.addedClosed} closed`];
      const skipped = [res.rejected ? `${res.rejected} invalid` : "", res.duplicates ? `${res.duplicates} already here` : ""].filter(Boolean).join(", ");
      toast.success(`Imported ${parts.join(" and ")}`, { description: skipped ? `Skipped: ${skipped}.` : "Merged with your existing positions." });
    };
    reader.onerror = () => toast.error("Could not read the file");
    reader.readAsText(file);
  };

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" disabled={disabled} onClick={() => {
          if (!downloadText(`positions-${istDateString()}.json`, exportPositions())) toast.error("Download failed", { description: "Your browser blocked the file download." });
        }}>
        <Download aria-hidden="true" /> Export
      </Button>
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
        <Upload aria-hidden="true" /> Import
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        aria-label="Import positions JSON"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
