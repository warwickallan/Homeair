import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// PWA: only registers on a secure context (https or localhost). Over plain
// http on a Tailscale IP the app still works; "Add to Home Screen" is then a
// bookmark. Use `tailscale serve` for https if you want the full install.
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
