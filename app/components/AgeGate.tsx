"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const STORAGE_KEY = "xcliprank_age_confirmed_v1";
const EXEMPT_PATHS = new Set([
  "/privacy",
  "/terms",
  "/contact",
  "/copyright",
  "/advertising-disclosure",
  "/removal-request",
]);

export default function AgeGate() {
  const pathname = usePathname();
  const exempt = EXEMPT_PATHS.has(pathname);
  const [visible, setVisible] = useState(!exempt);

  useEffect(() => {
    if (exempt) {
      setVisible(false);
      document.body.classList.remove("age-gate-open");
      return;
    }

    let accepted = false;
    try {
      accepted = window.localStorage.getItem(STORAGE_KEY) === "yes";
    } catch {
      accepted = false;
    }

    setVisible(!accepted);
    document.body.classList.toggle("age-gate-open", !accepted);

    return () => document.body.classList.remove("age-gate-open");
  }, [exempt]);

  function accept() {
    try {
      window.localStorage.setItem(STORAGE_KEY, "yes");
    } catch {
      // Continue for the current visit when storage is unavailable.
    }
    document.body.classList.remove("age-gate-open");
    setVisible(false);
  }

  if (!visible || exempt) return null;

  return (
    <div className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-gate-title" aria-describedby="age-gate-description">
      <div className="age-gate-panel">
        <p className="age-gate-brand"><span>X</span> CLIP RANK</p>
        <h2 id="age-gate-title">18歳以上ですか？</h2>
        <p id="age-gate-description">
          当サイトには成人向けの内容が含まれます。18歳未満の方、または居住地域の法令上閲覧できない方は利用できません。
        </p>
        <div className="age-gate-actions">
          <button className="age-gate-enter" type="button" onClick={accept}>18歳以上です</button>
          <button className="age-gate-exit" type="button" onClick={() => window.location.replace("https://www.google.com/")}>退出する</button>
        </div>
        <p className="age-gate-links">
          <Link href="/terms">利用規約</Link> ・ <Link href="/privacy">プライバシーポリシー</Link>
        </p>
      </div>
    </div>
  );
}
