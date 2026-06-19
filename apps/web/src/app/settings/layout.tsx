import type { ReactNode } from "react";

import { AppShell } from "@/components/dashboard/app-shell";

export default function SettingsLayout({ children }: { children: ReactNode }): React.ReactElement {
  return <AppShell>{children}</AppShell>;
}
