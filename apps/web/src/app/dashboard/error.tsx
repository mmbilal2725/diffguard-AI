"use client";

import type { ReactElement } from "react";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatePanel } from "@/components/dashboard/state-panel";
import { Button } from "@/components/ui/button";

export default function DashboardError({
  reset,
}: {
  reset: () => void;
}): ReactElement {
  return (
    <>
      <PageHeader
        title="Dashboard unavailable"
        description="DiffGuard-AI could not load production monitoring data from the dashboard API."
      />
      <StatePanel
        title="Unable to load dashboard data"
        description="Check that apps/api is reachable, DIFFGUARD_DASHBOARD_API_KEY is configured on the server, and this origin is allowed by DIFFGUARD_ALLOWED_ORIGINS."
        actions={
          <Button type="button" size="sm" onClick={reset}>
            Retry
          </Button>
        }
      />
    </>
  );
}
