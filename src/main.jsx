import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import PwaInstallPrompt from "./PwaInstallPrompt.jsx";
import "./styles.css";

function Root() {
  React.useEffect(() => {
    const isAdmin = window.location.pathname.startsWith("/admin");
    const manifest = document.querySelector('link[rel="manifest"]');
    const themeColor = document.querySelector('meta[name="theme-color"]');

    if (manifest) {
      manifest.setAttribute(
        "href",
        isAdmin ? "/admin-manifest.webmanifest" : "/manifest.webmanifest"
      );
    }

    if (themeColor) {
      themeColor.setAttribute("content", isAdmin ? "#070a09" : "#0a0d0c");
    }

    if (!("serviceWorker" in navigator)) return undefined;

    const registerServiceWorker = () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // L'installation reste disponible meme si le cache hors-ligne est refuse.
      });
    };

    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker, { once: true });
    }

    return () => window.removeEventListener("load", registerServiceWorker);
  }, []);

  return (
    <>
      <App />
      <PwaInstallPrompt />
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
