import { DashboardMain } from "@/components/dashboard-main";
import { DashboardNav } from "@/components/dashboard-nav";
import { LocaleSync } from "@/components/locale-sync";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <LocaleSync />
      <DashboardNav />
      <DashboardMain>{children}</DashboardMain>
    </div>
  );
}
