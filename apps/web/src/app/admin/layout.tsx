import type { Metadata } from "next";
import { AdminNav } from "@/components/admin/admin-nav";
import { requireStaff } from "@/server/admin/guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Administration", template: "%s · Administration" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Non-personnel : 404. (Chaque page revérifie : un layout n'est pas rejoué à chaque navigation.)
  const staff = await requireStaff("SUPPORT");
  return (
    <div className="min-h-dvh bg-white lg:flex">
      <AdminNav role={staff.role} email={staff.email} />
      <main className="min-w-0 flex-1 px-5 py-8 sm:px-8 lg:px-12 lg:py-10"><div className="mx-auto max-w-[1180px]">{children}</div></main>
    </div>
  );
}
