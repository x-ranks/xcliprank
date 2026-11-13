"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Phone-only bottom navigation for the public pages (hidden by CSS on wide screens).
const TABS = [
  { href: "/rising", label: "急上昇", icon: "M12 3c1 3.5 5 5.2 5 10a5 5 0 0 1-10 0c0-2 1-3.2 2-4 .2 1.4 1 2 1.8 2C10.5 8 11 5.5 12 3z" },
  { href: "/discover", label: "探す", icon: "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM15.5 8.5l-2 5-5 2 2-5z" },
  { href: "/following", label: "フォロー", icon: "M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4" },
  { href: "/favorites", label: "保存", icon: "M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 16.9 6.8 19.7l1-5.9L3.5 9.7l5.9-.8z" },
] as const;
const PUBLIC = /^\/(?:$|(?:rising|ranking|reels|browse|discover|tags|accounts|months|following|favorites|p)(?:\/|$))/;
export function activeTab(pathname: string): string | null {
  if (/^\/(?:$|(?:rising|ranking|reels|browse)(?:\/|$))/.test(pathname)) return "/rising";
  if (/^\/(?:discover|tags|accounts|months)(?:\/|$)/.test(pathname)) return "/discover";
  if (/^\/following(?:\/|$)/.test(pathname)) return "/following";
  if (/^\/favorites(?:\/|$)/.test(pathname)) return "/favorites";
  return null;
}
export default function BottomTabs() {
  const pathname = usePathname() ?? "";
  if (!PUBLIC.test(pathname)) return null;
  const active = activeTab(pathname);
  return <>
    <nav className="bottom-tabs" aria-label="メインメニュー">
      {TABS.map(tab => <Link key={tab.href} href={tab.href} prefetch={false} aria-current={active === tab.href ? "page" : undefined}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={tab.icon} /></svg>
        <span>{tab.label}</span>
      </Link>)}
    </nav>
    <div className="bottom-tabs-spacer" aria-hidden="true" />
  </>;
}
