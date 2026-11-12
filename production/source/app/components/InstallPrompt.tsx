"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { isStandaloneDisplay } from "../../lib/engagement-surface";
import {
  INSTALLED_KEY, INSTALL_DISMISSED_KEY, VISIT_DAYS_KEY,
  addVisitDay, installMode, shouldOfferInstall, type InstallMode
} from "../../lib/install-prompt";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/** A quiet bar asking a returning visitor to add twizou to the home screen. Nothing is shown on a first-day visit. */
export default function InstallPrompt() {
  const pathname = usePathname() ?? "/";
  const [mode, setMode] = useState<InstallMode>(null);
  const [offer, setOffer] = useState<InstallEvent | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onPrompt = (event: Event) => { event.preventDefault(); setOffer(event as InstallEvent); };
    const onInstalled = () => { try { localStorage.setItem(INSTALLED_KEY, "yes"); } catch { /* optional */ } setVisible(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  useEffect(() => {
    try {
      const now = Date.now();
      const standalone = isStandaloneDisplay(window);
      let days: string[] = [];
      try { days = addVisitDay(JSON.parse(localStorage.getItem(VISIT_DAYS_KEY) || "[]"), now); localStorage.setItem(VISIT_DAYS_KEY, JSON.stringify(days)); } catch { /* optional */ }
      let dismissedAt: unknown = null;
      let installed = false;
      try { dismissedAt = JSON.parse(localStorage.getItem(INSTALL_DISMISSED_KEY) || "null"); installed = localStorage.getItem(INSTALLED_KEY) === "yes"; } catch { /* optional */ }
      const next = installMode({ canPrompt: Boolean(offer), userAgent: navigator.userAgent, standalone });
      setMode(next);
      setVisible(Boolean(next) && shouldOfferInstall({
        days, dismissedAt, installed, standalone, now, path: pathname,
        ageConfirmed: document.documentElement.getAttribute("data-age-confirmed") === "yes"
      }));
    } catch { setVisible(false); }
  }, [pathname, offer]);

  function later() {
    try { localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now())); } catch { /* optional */ }
    setVisible(false);
  }

  async function install() {
    if (!offer) return;
    try { await offer.prompt(); await offer.userChoice; } catch { /* The browser decides. */ }
    setOffer(null);
    later();
  }

  if (!visible || !mode) return null;
  return <aside className="install-prompt" role="region" aria-label="ホーム画面に追加">
    <p>{mode === "prompt" && "twizouをホーム画面に追加すると、検索しなくてもすぐ開けます。"}
      {mode === "ios" && "共有ボタンから「ホーム画面に追加」を選ぶと、すぐ開けるようになります。"}
      {mode === "open-in-browser" && "今開いているアプリの画面では追加できません。SafariやChromeで開くと、ホーム画面に追加できます。"}</p>
    <div>{mode === "prompt" && <button type="button" className="install-prompt-add" onClick={() => void install()}>追加する</button>}
      <button type="button" className="install-prompt-later" onClick={later}>{mode === "prompt" ? "あとで" : "閉じる"}</button></div>
  </aside>;
}
