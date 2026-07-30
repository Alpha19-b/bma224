import React, { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";

const DISMISS_KEY = "bma-install-prompt-dismissed-at";
const DISMISS_FOR = 1000 * 60 * 60 * 24 * 7;

function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    window.navigator.standalone === true
  );
}

function isIosDevice() {
  return /iPad|iPhone|iPod/.test(window.navigator.userAgent) ||
    (window.navigator.platform === "MacIntel" && window.navigator.maxTouchPoints > 1);
}

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState(null);
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    if (window.location.pathname.startsWith("/admin") || isStandalone()) return undefined;

    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    if (dismissedAt && Date.now() - dismissedAt < DISMISS_FOR) return undefined;

    const iosDevice = isIosDevice();
    setIos(iosDevice);

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setInstallEvent(event);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    const iosTimer = iosDevice
      ? window.setTimeout(() => setVisible(true), 1800)
      : undefined;

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      if (iosTimer) window.clearTimeout(iosTimer);
    };
  }, []);

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  }

  async function install() {
    if (!installEvent) return;

    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <aside className="pwa-install-prompt" role="dialog" aria-label="Installer BMA">
      <div className="pwa-install-icon" aria-hidden="true">BMA</div>
      <div className="pwa-install-copy">
        <strong>Garde BMA sous la main</strong>
        {ios ? (
          <span><Share2 size={14} aria-hidden="true" /> Partager puis « Sur l'ecran d'accueil ».</span>
        ) : (
          <span>Installe l'app pour retrouver tes articles plus vite.</span>
        )}
      </div>
      {installEvent ? (
        <button className="pwa-install-action" type="button" onClick={install}>
          <Download size={17} aria-hidden="true" />
          Installer
        </button>
      ) : null}
      <button className="pwa-install-close" type="button" onClick={dismiss} aria-label="Fermer">
        <X size={18} aria-hidden="true" />
      </button>
    </aside>
  );
}
