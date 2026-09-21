"use client";

import Link from "next/link";
import { publicCopy, usePublicLanguage } from "@/components/public-language";

export default function PublicFooter() {
  const { language } = usePublicLanguage();
  const copy = publicCopy[language];
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <nav className="site-footer-links" aria-label="Legal information">
          <Link href="/terms">{copy.terms}</Link>
          <Link href="/privacy">{copy.privacy}</Link>
          <Link href="/cookies">{copy.cookies}</Link>
          <Link href="/accessibility">{copy.accessibility}</Link>
        </nav>
        <div className="site-footer-bottom"><span>Copyright © Powerchair Floorball Battle</span></div>
      </div>
    </footer>
  );
}
