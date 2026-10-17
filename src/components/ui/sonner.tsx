import { Toaster as Sonner, toast } from "sonner";
import { useTheme } from "@/hooks/useTheme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { mode } = useTheme();

  return (
    <Sonner
      theme={mode as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-tile group-[.toaster]:border group-[.toaster]:border-border group-[.toaster]:bg-card group-[.toaster]:text-foreground group-[.toaster]:shadow-float group-[.toaster]:font-sans",
          title: "group-[.toast]:font-semibold",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-pill group-[.toast]:bg-primary group-[.toast]:font-semibold group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:rounded-pill group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          success: "group-[.toaster]:border-bullish/30 group-[.toaster]:bg-wash-profit group-[.toaster]:text-foreground",
          error: "group-[.toaster]:border-bearish/30 group-[.toaster]:bg-wash-loss group-[.toaster]:text-foreground",
          warning: "group-[.toaster]:border-warning/30 group-[.toaster]:bg-wash-warning group-[.toaster]:text-foreground",
          info: "group-[.toaster]:border-info/30 group-[.toaster]:bg-wash-info group-[.toaster]:text-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
