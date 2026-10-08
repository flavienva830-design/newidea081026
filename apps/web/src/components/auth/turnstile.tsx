"use client";

import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void };
  }
}

const SITE_KEY = process.env["NEXT_PUBLIC_TURNSTILE_SITE_KEY"];

/** Widget anti-robot (Cloudflare Turnstile). Absent si aucune clé n'est configurée (développement). */
export function Turnstile({ onToken, resetKey }: { onToken: (t: string | null) => void; resetKey?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const id = useRef<string | null>(null);

  useEffect(() => {
    if (!SITE_KEY) return;
    const mount = () => {
      if (!ref.current || !window.turnstile || id.current) return;
      id.current = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY, theme: "light", language: "fr",
        callback: (t: string) => onToken(t),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
    };
    if (window.turnstile) mount();
    else if (!document.getElementById("cf-turnstile")) {
      const s = document.createElement("script");
      s.id = "cf-turnstile";
      s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      s.async = true;
      s.onload = mount;
      document.head.appendChild(s);
    } else {
      document.getElementById("cf-turnstile")!.addEventListener("load", mount);
    }
    return () => { if (id.current && window.turnstile) { window.turnstile.remove(id.current); id.current = null; } };
  }, [onToken]);

  useEffect(() => { if (resetKey && id.current) window.turnstile?.reset(id.current); }, [resetKey]);

  if (!SITE_KEY) return null;
  return <div ref={ref} className="min-h-[65px]" />;
}

export const captchaEnabled = Boolean(SITE_KEY);
