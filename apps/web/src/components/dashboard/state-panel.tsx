import type { ReactElement, ReactNode } from "react";

import { cn } from "@/lib/utils";

type StatePanelProps = {
  actions?: ReactNode;
  className?: string;
  description: string;
  title: string;
};

export function StatePanel({
  actions,
  className,
  description,
  title,
}: StatePanelProps): ReactElement {
  return (
    <div className={cn("rounded-md border border-dashed bg-muted/30 p-6", className)}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
        </div>
        {actions === undefined ? null : <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function LoadingPanel({
  description,
  title = "Loading dashboard data",
}: {
  description: string;
  title?: string;
}): ReactElement {
  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-6">
      <div className="h-4 w-44 animate-pulse rounded bg-muted" />
      <div className="h-3 w-full max-w-xl animate-pulse rounded bg-muted" />
      <div className="h-3 w-2/3 max-w-md animate-pulse rounded bg-muted" />
      <span className="sr-only">
        {title}: {description}
      </span>
    </div>
  );
}
