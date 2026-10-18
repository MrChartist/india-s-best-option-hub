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
            "group toast group-[.toaster]:mac-menu group-[.toaster]:rounded-panel group-[.toaster]:border-0 group-[.toaster]:text-body group-[.toaster]:text-foreground group-[.toaster]:font-sans",
          title: "group-[.toast]:font-semibold",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:rounded-pill group-[.toast]:bg-primary group-[.toast]:font-medium group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:rounded-pill group-[.toast]:bg-control group-[.toast]:text-foreground group-[.toast]:shadow-control",
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
