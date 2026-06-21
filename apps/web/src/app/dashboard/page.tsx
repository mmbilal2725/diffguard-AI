import { Activity, AlertTriangle, CheckCircle2, HelpCircle, MessageSquare, XCircle } from "lucide-react";
import Link from "next/link";

import { CostLatencyChart, ReviewTrendChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatCurrency,
  formatDuration,
  formatPercent,
  getDashboardOverview,
  getReviewRuns
} from "@/lib/dashboard-data";

export default async function DashboardPage(): Promise<React.ReactElement> {
  const [overview, reviewRuns] = await Promise.all([getDashboardOverview(), getReviewRuns()]);
  const metrics = overview.metrics;
  const recentRuns = reviewRuns.slice(0, 4);

  return (
    <>
      <PageHeader
        title="Review operations"
        description="Track whether DiffGuard-AI is catching high-confidence bugs, rejecting noisy findings, and staying within latency and cost targets."
        actions={
          <>
            <Badge variant="outline">Live API data</Badge>
            <Button asChild size="sm">
              <Link href="/dashboard/reviews">Open review runs</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Overview metrics">
        <MetricCard
          title="Posted findings"
          value={String(metrics.findingsPosted)}
          detail="Validator-approved GitHub review comments stored for tracking"
          icon={MessageSquare}
        />
        <MetricCard
          title="Resolved findings"
          value={String(metrics.resolvedFindings)}
          detail="Posted findings likely fixed in a later PR update"
          icon={CheckCircle2}
        />
        <MetricCard
          title="Unresolved findings"
          value={String(metrics.unresolvedFindings)}
          detail="Posted findings that still appear present"
          icon={AlertTriangle}
        />
        <MetricCard
          title="False positives"
          value={String(metrics.falsePositiveFindings)}
          detail="Posted findings later judged likely unsupported"
          icon={XCircle}
        />
        <MetricCard
          title="Unknown"
          value={String(metrics.unknownFindings)}
          detail="Findings without enough latest evidence to classify"
          icon={HelpCircle}
        />
        <MetricCard
          title="Estimated resolution rate"
          value={formatPercent(metrics.estimatedResolutionRate)}
          detail="Resolved findings divided by posted findings"
          icon={Activity}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Findings and validator decisions</CardTitle>
            <CardDescription>Posted findings compared with rejected candidate findings.</CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewTrendChart data={overview.reviewTrend} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cost and latency</CardTitle>
            <CardDescription>Daily spend and review turnaround time.</CardDescription>
          </CardHeader>
          <CardContent>
            <CostLatencyChart data={overview.reviewTrend} />
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <CardTitle>Recent review runs</CardTitle>
            <CardDescription>Latest pull request reviews from the worker pipeline.</CardDescription>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/reviews">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead>PR</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Latency</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recentRuns.map((run) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <Link href={`/dashboard/reviews/${run.id}`} className="font-medium hover:underline">
                      {run.repo}
                    </Link>
                  </TableCell>
                  <TableCell>#{run.prNumber}</TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell>{run.findingsCount}</TableCell>
                  <TableCell>{formatCurrency(run.costUsd)}</TableCell>
                  <TableCell>{formatDuration(run.latencySeconds)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
