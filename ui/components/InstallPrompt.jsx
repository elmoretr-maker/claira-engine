import { useEffect, useState } from "react";
import "./InstallPrompt.css";

/**
 * Captures the browser's beforeinstallprompt event and shows a subtle
 * "Install Claira" banner.
 *
 * Rules:
 *  - Only renders when the browser decides the PWA install criteria are met.
 *  - Never shows in standalone / fullscreen mode (already installed or Electron).
 *  - Dismissible — user choice is remembered in sessionStorage.
 */
export default function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Already running as installed PWA or inside Electron — no banner needed.
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (window.matchMedia("(display-mode: fullscreen)").matches) return;

    // User already dismissed this session.
    if (sessionStorage.getItem("claira_install_dismissed") === "1") return;

    const handler = (e) => {
      e.preventDefault(); // prevent the default mini-infobar
      setDeferredPrompt(e);
      setVisible(true);
    };

    window.addEventListener("beforeinstallprompt", handler);

    // If already installed, clean up.
    window.addEventListener("appinstalled", () => setVisible(false));

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setVisible(false);
  }

  function handleDismiss() {
    sessionStorage.setItem("claira_install_dismissed", "1");
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="install-prompt" role="complementary" aria-label="Install Claira">
      <span className="install-prompt__text">
        Install Claira for faster access
      </span>
      <button className="install-prompt__btn install-prompt__btn--install" onClick={handleInstall}>
        Install App
      </button>
      <button
        className="install-prompt__btn install-prompt__btn--dismiss"
        onClick={handleDismiss}
        aria-label="Dismiss install prompt"
      >
        ✕
      </button>
    </div>
  );
}
