import type { Metadata } from "next";
import { Suspense } from "react";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Créer mon espace" };

export default function SignupPage() {
  return <Suspense><SignupForm /></Suspense>;
}
