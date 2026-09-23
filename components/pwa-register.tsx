"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const register = () => navigator.serviceWorker.register("/sw.js").catch(() => undefined);
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(register, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(register, 1500);
    return () => window.clearTimeout(id);
  }, []);
  return null;
}
