import { SettingsNav } from "./settings-nav";

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[760px]">
      <SettingsNav />
      <div className="mt-10">{children}</div>
    </div>
  );
}
