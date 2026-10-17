import { createRoot } from "react-dom/client";
import { toast } from "sonner";
import App from "./App.tsx";
import { registerServiceWorker } from "@/lib/marketData/serviceWorker";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);

// PWA: production builds with vite-plugin-pwa installed only (vite.config.ts sets the flag).
if (import.meta.env.PROD && import.meta.env.VITE_PWA_ENABLED === "true") {
  window.addEventListener("load", () => {
    void registerServiceWorker({
      onUpdateReady: (apply) => {
        toast("Update available", {
          id: "pwa-update",
          description: "A new version of the terminal is ready. Reload to use it.",
          duration: Infinity,
          action: { label: "Reload", onClick: apply },
        });
      },
      onOfflineReady: () => {
        toast("Ready to work offline", {
          id: "pwa-offline-ready",
          description: "The app is cached on this device. Live market data still needs the proxy.",
        });
      },
    });
  });
}
