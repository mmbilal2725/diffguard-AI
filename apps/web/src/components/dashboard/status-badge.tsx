import { Badge } from "@/components/ui/badge";
import type {
  GitHubCommentStatus,
  ReviewRunStatus,
  ValidatorDecision
} from "@/lib/dashboard-data";

type Status = ReviewRunStatus | ValidatorDecision | GitHubCommentStatus | "enabled" | "disabled";

const labels: Record<Status, string> = {
  accepted: "Accepted",
  analyzing: "Analyzing",
  completed: "Completed",
  deduplicated: "Deduplicated",
  disabled: "Disabled",
  enabled: "Enabled",
  failed: "Failed",
  pending: "Pending",
  posted: "Posted",
  queued: "Queued",
  rejected: "Rejected",
  skipped: "Skipped",
  validating: "Validating"
};

export function StatusBadge({ status }: { status: Status }): React.ReactElement {
  const variant = status === "failed" || status === "rejected" ? "destructive" : "secondary";

  return (
    <Badge
      variant={variant}
      className={
        status === "completed" || status === "accepted" || status === "posted" || status === "enabled"
          ? "bg-primary text-primary-foreground"
          : undefined
      }
    >
      {labels[status]}
    </Badge>
  );
}
