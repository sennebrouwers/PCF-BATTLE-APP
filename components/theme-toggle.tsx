"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";

// The inline script in app/layout.tsx sets <html data-theme> before paint, so the
// attribute is the source of truth. Reading it through useSyncExternalStore keeps
// the server-rendered markup and the first client render identical (no hydration
// mismatch), then updates to the real theme right after hydration.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}
const getSnapshot = () => document.documentElement.dataset.theme === "dark";
const getServerSnapshot = () => false;

function applyTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export default function ThemeToggle() {
  const dark = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    // Re-apply on mount: if React regenerates the tree after a hydration error
    // elsewhere, the attribute set by the layout script is lost.
    const saved = window.localStorage.getItem("pcf-theme");
    applyTheme(saved ? saved === "dark" : media.matches);
    const followSystem = () => {
      if (!window.localStorage.getItem("pcf-theme")) applyTheme(media.matches);
    };
    media.addEventListener?.("change", followSystem);
    return () => media.removeEventListener?.("change", followSystem);
  }, []);
  function toggle() {
    const value = !dark;
    localStorage.setItem("pcf-theme", value ? "dark" : "light");
    applyTheme(value);
  }
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={dark ? "Use light mode" : "Use dark mode"} title={dark ? "Light mode" : "Dark mode"}>{dark ? <Sun /> : <Moon />}</button>;
}
