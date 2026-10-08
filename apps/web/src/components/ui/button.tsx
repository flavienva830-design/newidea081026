"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { motion, useMotionValue, useSpring } from "framer-motion";
import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/cn";

const button = cva(
  "relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-[background,color,box-shadow,border-color] duration-300 ease-out-expo disabled:pointer-events-none disabled:opacity-50 select-none",
  {
    variants: {
      variant: {
        primary: "bg-accent text-fg hover:bg-accent-strong hover:text-white shadow-[0_1px_0_rgba(255,255,255,0.4)_inset,0_6px_20px_rgba(73,168,255,0.35)]",
        dark: "bg-fg text-white hover:bg-[#2a2a2a]",
        secondary: "bg-white text-fg border border-line-strong hover:border-fg",
        ghost: "text-fg hover:bg-muted",
        danger: "bg-danger text-white hover:bg-[#b42318]",
      },
      size: { sm: "h-9 px-4 text-[13px]", md: "h-11 px-6 text-[14px]", lg: "h-[52px] px-8 text-[15px]" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof button> & { loading?: boolean; href?: string; magnetic?: boolean };

/** Bouton avec micro-interaction « magnétique » légère (désactivée si mouvement réduit ou sur écran tactile). */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, href, magnetic, children, disabled, ...props },
  ref,
) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 300, damping: 20, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 300, damping: 20, mass: 0.4 });

  const onMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!magnetic || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    x.set((e.clientX - (r.left + r.width / 2)) * 0.18);
    y.set((e.clientY - (r.top + r.height / 2)) * 0.28);
  };
  const reset = () => { x.set(0); y.set(0); };

  const cls = cn(button({ variant, size }), className);
  const inner = (
    <>
      {loading && <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      <span className={cn("inline-flex items-center gap-2", loading && "opacity-80")}>{children}</span>
    </>
  );

  if (href) {
    return (
      <motion.span style={{ x: sx, y: sy }} className="inline-flex" onPointerMove={onMove} onPointerLeave={reset}>
        <Link href={href} className={cls}>{inner}</Link>
      </motion.span>
    );
  }
  return (
    <motion.button
      ref={ref}
      style={{ x: sx, y: sy }}
      whileTap={{ scale: 0.97 }}
      onPointerMove={onMove}
      onPointerLeave={reset}
      className={cls}
      disabled={disabled || loading}
      {...(props as object)}
    >
      {inner}
    </motion.button>
  );
});
