import type { ReactNode } from "react";

import { AppShell } from "@/components/dashboard/app-shell";

export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: ReactNode }): React.ReactElement {
  return <AppShell>{children}</AppShell>;
}
