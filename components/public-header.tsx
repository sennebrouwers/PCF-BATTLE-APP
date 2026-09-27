"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ChevronRight, Menu, X } from "lucide-react";
import ThemeToggle from "@/components/theme-toggle";
import { publicCopy, usePublicLanguage } from "@/components/public-language";

type TournamentSettings = {
  live_enabled?: number;
  show_tournament?: number;
  show_referees?: number;
  emergency_enabled?: number;
  emergency_message?: string;
  show_matches?: number;
  show_standings?: number;
  show_brackets?: number;
  show_statistics?: number;
  show_gallery?: number;
  show_about?: number;
  show_livestream?: number;
};

export default function PublicHeader({
  settings,
  currentPath,
  hideNav = false,
  loading = false,
}: {
  settings?: TournamentSettings;
  currentPath?: string;
  hideNav?: boolean;
  loading?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  const [cachedSettings, setCachedSettings] = useState<TournamentSettings | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    try {
      const value = sessionStorage.getItem("pcf-public-navigation");
      return value ? JSON.parse(value) : undefined;
    } catch {
      return undefined;
    }
  });
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    addEventListener("keydown", close);
    return () => removeEventListener("keydown", close);
  }, [menuOpen]);
  useEffect(() => {
    if (loading || !settings) return;
    setCachedSettings(settings);
    try {
      sessionStorage.setItem("pcf-public-navigation", JSON.stringify(settings));
    } catch {}
  }, [loading, settings]);
  const navigationSettings = !loading && settings ? settings : cachedSettings;
  const ready = Boolean(navigationSettings);
  const tournamentPages = [
    ["/tournament/live", ready && navigationSettings!.show_tournament !== 0 && navigationSettings!.live_enabled !== 0 && navigationSettings!.show_matches !== 0],
    ["/tournament/schedule", ready && navigationSettings!.show_tournament !== 0 && navigationSettings!.show_matches !== 0],
    ["/tournament/standings", ready && navigationSettings!.show_tournament !== 0 && navigationSettings!.show_standings !== 0],
    ["/tournament/brackets", ready && navigationSettings!.show_tournament !== 0 && navigationSettings!.show_brackets !== 0],
    ["/tournament/statistics", ready && navigationSettings!.show_tournament !== 0 && navigationSettings!.show_statistics !== 0],
  ] as [string, boolean][];
  const tournamentHref = tournamentPages.find(([, visible]) => visible)?.[0] || "/tournament/live";
  const links = [
    [tournamentHref, copy.tournament, ready && tournamentPages.some(([, visible]) => visible)],
    ["/about", copy.practical, ready && navigationSettings!.show_about !== 0],
    ["/faq", copy.faq, ready],
    ["/livestream", copy.livestream, ready && navigationSettings!.show_livestream === 1],
    ["/gallery", copy.media, ready && navigationSettings!.show_gallery === 1],
  ].filter((item) => item[2]) as [string, string, boolean][];

  return (
    <>
    {settings?.emergency_enabled === 1 && settings.emergency_message?.trim() && <aside className="public-emergency" role="alert"><strong>Important tournament update</strong><span>{settings.emergency_message}</span></aside>}
    <header className="public-header">
      <Link className="brand" href="/">
        <Image src="/PFB_Logo_Pink.svg" alt="PCF Battle" width={54} height={64} unoptimized />
        <span>PCF <b>BATTLE</b></span>
      </Link>
      {!hideNav && (
        <nav
          id="public-mobile-navigation"
          aria-label={copy.mainNavigation}
          className={`${!ready ? "nav-pending " : ""}${menuOpen ? "mobile-open" : ""}`.trim()}
        >
          {links.map(([href, label]) => (
            <Link onClick={() => setMenuOpen(false)} className={(href.startsWith("/tournament/") ? currentPath?.startsWith("/tournament/") : currentPath === href) ? "active" : ""} href={href} key={label}>
              {label}
            </Link>
          ))}
          <Link className="mobile-login" onClick={() => setMenuOpen(false)} href="/login">Log in</Link>
        </nav>
      )}
      {!hideNav && (
        <button
          className="public-menu-toggle"
          type="button"
          aria-label={menuOpen ? copy.closeMenu : copy.openMenu}
          aria-controls="public-mobile-navigation"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((open) => !open)}
        >
          {menuOpen ? <X /> : <Menu />}
        </button>
      )}
      <div className="head-actions">
        <ThemeToggle />
        <a
          className="instagram-link"
          href="https://www.instagram.com/pcfbattle/"
          target="_blank"
          rel="noreferrer"
          aria-label="Instagram"
          title="Instagram"
        >
          <span className="instagram-glyph" aria-hidden="true" />
        </a>
        <a
          className="facebook-link"
          href="https://www.facebook.com/pcfbattle"
          target="_blank"
          rel="noreferrer"
          aria-label="Facebook"
          title="Facebook"
        >
          <svg className="facebook-glyph" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M14 8h3V4h-3c-3.31 0-5 1.97-5 5v3H6v4h3v8h4v-8h3.2l.8-4H13V9c0-.66.34-1 1-1Z" fill="currentColor" />
          </svg>
        </a>
        <Link className="login" href="/login">Log in <ChevronRight /></Link>
      </div>
    </header>
    </>
  );
}
