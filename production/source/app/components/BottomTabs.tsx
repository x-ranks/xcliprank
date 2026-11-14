"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

// Phone-only bottom navigation for the public pages (hidden by CSS on wide screens).
// Five links plus a MENU button that opens a sheet holding everything else.
const TABS = [
  { href: "/rising", label: "急上昇", icon: "M12 3c1 3.5 5 5.2 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 .2 1.4 1 2 1.8 2C10.5 8 11 5.5 12 3z" },
  { href: "/ranking/daily", label: "ランキング", icon: "M5 20V11h4v9M10 20V5h4v15M15 20v-6h4v6" },
  { href: "/", label: "新着", icon: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 8v4.5l3 1.8" },
  { href: "/favorites", label: "保存", icon: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" },
  { href: "/discover?mode=search", label: "検索", icon: "M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM16 16l4.5 4.5" },
] as const;
const MENU_ICON = "M4 7h16M4 12h16M4 17h16";
const PUBLIC = /^\/(?:$|(?:rising|ranking|reels|browse|discover|tags|accounts|months|following|favorites|download|p)(?:\/|$))/;

const MENU_SECTIONS = [
  { title: "探す", items: [
    { href: "/discover?mode=random", label: "ランダム" },
    { href: "/accounts", label: "投稿者一覧" },
    { href: "/discover?mode=tier", label: "Tierで探す" },
    { href: "/ranking/weekly", label: "週間ランキング" },
    { href: "/months", label: "月別ランキング" },
    { href: "/reels", label: "リール" },
  ] },
  { title: "自分用", items: [
    { href: "/following", label: "フォロー新着" },
    { href: "/favorites", label: "お気に入り・履歴" },
  ] },
  { title: "動画を保存", items: [
    { href: "/download", label: "URLから保存" },
    { href: "/download/iphone", label: "iPhoneでの保存方法" },
    { href: "/download/android", label: "Androidでの保存方法" },
  ] },
] as const;

/** Which bottom tab is lit for a path. `mode` is the /discover ?mode value (search is its own tab; random/tier live in MENU). */
export function activeTab(pathname: string, mode: string | null = null): string | null {
  if (/^\/rising(?:\/|$)/.test(pathname)) return "/rising";
  if (/^\/ranking(?:\/|$)/.test(pathname)) return "/ranking/daily";
  if (/^\/(?:$|browse(?:\/|$))/.test(pathname)) return "/";
  if (/^\/favorites(?:\/|$)/.test(pathname)) return "/favorites";
  if (/^\/discover(?:\/|$)/.test(pathname)) return mode === "random" || mode === "tier" ? "menu" : "/discover?mode=search";
  if (/^\/(?:tags|accounts|months|following|reels|download)(?:\/|$)/.test(pathname)) return "menu";
  return null;
}

export default function BottomTabs() {
  const pathname = usePathname() ?? "";
  const [mode, setMode] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
    setMode(new URLSearchParams(window.location.search).get("mode"));
  }, [pathname]);
  useEffect(() => {
    if (!open) return;
    document.body.classList.add("menu-open");
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => { document.body.classList.remove("menu-open"); document.removeEventListener("keydown", onKey); };
  }, [open]);
  if (!PUBLIC.test(pathname)) return null;
  const active = activeTab(pathname, mode);
  return <>
    <nav className="bottom-tabs" aria-label="メインメニュー">
      {TABS.map(tab => <Link key={tab.href} href={tab.href} prefetch={false} aria-current={active === tab.href ? "page" : undefined}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={tab.icon} /></svg>
        <span>{tab.label}</span>
      </Link>)}
      <button type="button" className="bottom-tabs-menu" aria-haspopup="dialog" aria-expanded={open} aria-current={active === "menu" ? "page" : undefined} onClick={() => setOpen(value => !value)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={MENU_ICON} /></svg>
        <span>MENU</span>
      </button>
    </nav>
    {open && <div className="menu-sheet-backdrop" onClick={() => setOpen(false)}>
      <div className="menu-sheet" role="dialog" aria-modal="true" aria-label="メニュー" onClick={event => event.stopPropagation()}>
        <div className="menu-sheet-grip" aria-hidden="true" />
        {MENU_SECTIONS.map(section => <section key={section.title} aria-label={section.title}>
          <h2>{section.title}</h2>
          <ul>{section.items.map(item => <li key={item.href}><Link href={item.href} prefetch={false} onClick={() => setOpen(false)}>{item.label}</Link></li>)}</ul>
        </section>)}
        <section aria-label="twizou">
          <h2>twizou</h2>
          <ul><li><a href="https://x.com/twizou_rank" target="_blank" rel="noopener noreferrer">Xで新着情報</a></li></ul>
        </section>
        <button type="button" className="menu-sheet-close" onClick={() => setOpen(false)}>閉じる</button>
      </div>
    </div>}
    <div className="bottom-tabs-spacer" aria-hidden="true" />
  </>;
}
