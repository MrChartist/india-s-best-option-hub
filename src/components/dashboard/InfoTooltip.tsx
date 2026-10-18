import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  text: string;
  label?: string;
}

export function InfoTooltip({ text, label = "More information" }: Props) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-6 w-6 items-center justify-center rounded-pill text-muted-foreground transition-colors hover:text-foreground focus-visible:shadow-focus focus-visible:outline-none"
        >
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-body-sm">
        {text}
      </TooltipContent>
    </Tooltip>
  );
}
