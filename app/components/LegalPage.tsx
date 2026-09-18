import Link from "next/link";
import type { ReactNode } from "react";
import SiteFooter from "./SiteFooter";

export default function LegalPage({
  title,
  lead,
  children,
}: {
  title: string;
  lead: string;
  children: ReactNode;
}) {
  return (
    <main className="legal-shell">
      <header className="legal-header">
        <Link className="legal-back" href="/">← X CLIP RANKへ戻る</Link>
        <h1>{title}</h1>
        <p className="legal-lead">{lead}</p>
        <p className="legal-updated">制定・最終更新：2026年9月18日</p>
      </header>
      <div className="legal-content">{children}</div>
      <SiteFooter />
    </main>
  );
}
