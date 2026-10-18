import * as React from "react";

import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[80px] w-full rounded-sm bg-control px-2 py-1.5 text-body text-foreground shadow-control transition-shadow duration-fast ease-out placeholder:text-muted-foreground focus-visible:shadow-[var(--shadow-control),var(--focus-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 [@media(pointer:coarse)]:text-base",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
