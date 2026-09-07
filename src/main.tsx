import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "@fontsource-variable/instrument-sans";
import "@fontsource-variable/fraunces/wght-italic.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-mono/700.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
