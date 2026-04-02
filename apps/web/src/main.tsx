import "katex/dist/katex.min.css";
import { registerSW } from "virtual:pwa-register";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

registerSW({
  onNeedRefresh() {
    console.info("A new version of min-kb-app is available. Reload to update.");
  },
  onOfflineReady() {
    console.info("min-kb-app is ready to work offline.");
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
