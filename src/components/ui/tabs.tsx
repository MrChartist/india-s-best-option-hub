import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

/** The active tab value, or null when used outside our Tabs wrapper. */
const ActiveTabContext = React.createContext<string | undefined | null>(null);

/**
 * Radix Tabs that also tracks the active value so inactive triggers can drop
 * aria-controls (Radix unmounts inactive panels, which would leave the attribute
 * pointing at an element that does not exist).
 */
const Tabs = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Root>
>(({ value, defaultValue, onValueChange, ...props }, ref) => {
  const [uncontrolled, setUncontrolled] = React.useState(defaultValue);
  const active = value !== undefined ? value : uncontrolled;
  const handleChange = React.useCallback(
    (next: string) => {
      setUncontrolled(next);
      onValueChange?.(next);
    },
    [onValueChange],
  );
  return (
    <ActiveTabContext.Provider value={active}>
      <TabsPrimitive.Root ref={ref} value={active} onValueChange={handleChange} {...props} />
    </ActiveTabContext.Provider>
  );
});
Tabs.displayName = TabsPrimitive.Root.displayName;

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-10 items-center justify-center gap-0.5 rounded-tile bg-muted p-1 text-muted-foreground",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => {
  const active = React.useContext(ActiveTabContext);
  const inactive = active !== null && active !== props.value;
  return (
    <TabsPrimitive.Trigger
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-tab px-3 py-1.5 text-sm font-semibold transition-[background-color,color,box-shadow] duration-fast ease-expo hover:text-foreground focus-visible:shadow-ember focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-card data-[state=active]:ring-1 data-[state=active]:ring-border dark:data-[state=active]:bg-white/10 dark:data-[state=active]:ring-white/15",
        className,
      )}
      {...props}
      {...(inactive ? { "aria-controls": undefined } : null)}
    />
  );
});
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn("mt-2 rounded-card focus-visible:shadow-ember focus-visible:outline-none", className)}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
