"use client";

import dynamic from "next/dynamic";

/** Visuel décoratif chargé après le premier affichage : il ne pèse ni sur le LCP ni sur le blocage du thread principal. */
const HeroVisual = dynamic(() => import("./hero-visual").then((m) => m.HeroVisual), {
  ssr: false,
  loading: () => <div aria-hidden className="h-[460px] w-full sm:h-[560px] lg:h-[680px]" />,
});

export function HeroVisualLazy() {
  return <HeroVisual />;
}
