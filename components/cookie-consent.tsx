"use client";

import Script from "next/script";
import { useSyncExternalStore } from "react";

const KEY = "pcf-cookie-consent";

export default function CookieConsent() {
  const choice = useSyncExternalStore(
    (onStoreChange) => {
      window.addEventListener("storage", onStoreChange);
      return () => window.removeEventListener("storage", onStoreChange);
    },
    () => localStorage.getItem(KEY),
    () => null,
  );
  function decide(value: "accepted" | "declined") {
    localStorage.setItem(KEY, value);
    window.dispatchEvent(new StorageEvent("storage", { key: KEY, newValue: value }));
  }
  return <>
    {choice === "accepted" && <>
      <Script src="https://www.googletagmanager.com/gtag/js?id=G-599N5QGLSG" strategy="afterInteractive" />
      <Script id="google-analytics" strategy="afterInteractive">{`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-599N5QGLSG');`}</Script>
    </>}
    {choice === null && <aside className="cookie-consent" aria-label="Cookie consent" aria-live="polite">
      <div><strong>Cookies & analytics</strong><p>We use optional analytics cookies to understand how the website is used and improve it.</p></div>
      <div className="cookie-consent-actions"><button className="cookie-decline" onClick={() => decide("declined")}>Reject non-essential</button><button className="cookie-accept" onClick={() => decide("accepted")}>Accept all</button></div>
    </aside>}
  </>;
}
