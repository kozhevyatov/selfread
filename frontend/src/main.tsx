import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AuthProvider } from "@/lib/auth";
import { Toaster } from "@/lib/toast";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
      <Toaster />
    </AuthProvider>
  </StrictMode>,
);

// PWA: установка на телефон. Только в собранной версии — в dev мешает горячей перезагрузке.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
