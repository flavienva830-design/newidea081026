import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetForm } from "./reset-form";

export const metadata: Metadata = { title: "Nouveau mot de passe", robots: { index: false } };

export default function Page() {
  return <Suspense><ResetForm /></Suspense>;
}
