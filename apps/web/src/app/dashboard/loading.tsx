import type { ReactElement } from "react";

import { LoadingPanel } from "@/components/dashboard/state-panel";

export default function DashboardLoading(): ReactElement {
  return (
    <div className="flex flex-col gap-6">
      <LoadingPanel description="Fetching current review, repository, finding, and eval telemetry from the API." />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Loading metric placeholders">
        {Array.from({ length: 6 }).map((_, index) => (
          <LoadingPanel
            key={index}
            title="Loading metric"
            description="Waiting for dashboard metric data."
          />
        ))}
      </section>
    </div>
  );
}
