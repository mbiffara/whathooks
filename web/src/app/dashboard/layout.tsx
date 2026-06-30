import { DashboardMain } from "@/components/dashboard-main";
import { DashboardNav } from "@/components/dashboard-nav";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <DashboardNav />
      <DashboardMain>{children}</DashboardMain>
    </div>
  );
}
