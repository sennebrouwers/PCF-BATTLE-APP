"use client";
import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const getSystemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
  const [dark, setDark] = useState(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("pcf-theme");
    return saved ? saved === "dark" : getSystemDark();
  });
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const followSystem = () => {
      if (!window.localStorage.getItem("pcf-theme")) setDark(media.matches);
    };
    media.addEventListener?.("change", followSystem);
    return () => media.removeEventListener?.("change", followSystem);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  function toggle() {
    const value = !dark;
    setDark(value);
    localStorage.setItem("pcf-theme", value ? "dark" : "light");
    document.documentElement.dataset.theme = value ? "dark" : "light";
  }
  return <button className="theme-toggle" type="button" onClick={toggle} aria-label={dark ? "Use light mode" : "Use dark mode"} title={dark ? "Light mode" : "Dark mode"}>{dark ? <Sun /> : <Moon />}</button>;
}
