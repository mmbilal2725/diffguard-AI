import { Activity, GitPullRequest, MessageSquare, Timer, Wallet, XCircle } from "lucide-react";
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
  getDashboardMetrics,
  getReviewRuns
} from "@/lib/dashboard-data";

export default function DashboardPage(): React.ReactElement {
  const metrics = getDashboardMetrics();
  const recentRuns = getReviewRuns().slice(0, 4);

  return (
    <>
      <PageHeader
        title="Review operations"
        description="Track whether DiffGuard-AI is catching high-confidence bugs, rejecting noisy findings, and staying within latency and cost targets."
        actions={
          <>
            <Badge variant="outline">30-day mock snapshot</Badge>
            <Button asChild size="sm">
              <Link href="/dashboard/reviews">Open review runs</Link>
            </Button>
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label="Overview metrics">
        <MetricCard
          title="Total PRs reviewed"
          value={String(metrics.totalPrsReviewed)}
          detail="Pull requests processed across connected repositories"
          icon={GitPullRequest}
        />
        <MetricCard
          title="Findings posted"
          value={String(metrics.findingsPosted)}
          detail="Validator-approved GitHub review comments"
          icon={MessageSquare}
        />
        <MetricCard
          title="Validator rejection rate"
          value={formatPercent(metrics.validatorRejectionRate)}
          detail="Candidate findings blocked before posting"
          icon={XCircle}
        />
        <MetricCard
          title="Estimated resolution rate"
          value={formatPercent(metrics.estimatedResolutionRate)}
          detail="Posted findings likely fixed or acknowledged"
          icon={Activity}
        />
        <MetricCard
          title="Review cost"
          value={formatCurrency(metrics.totalCostUsd)}
          detail="Estimated model cost for the current window"
          icon={Wallet}
        />
        <MetricCard
          title="Average latency"
          value={formatDuration(metrics.averageLatencySeconds)}
          detail="Median-sized pull request from webhook to completion"
          icon={Timer}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Findings and validator decisions</CardTitle>
            <CardDescription>Posted findings compared with rejected candidate findings.</CardDescription>
          </CardHeader>
          <CardContent>
            <ReviewTrendChart />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cost and latency</CardTitle>
            <CardDescription>Daily spend and review turnaround time.</CardDescription>
          </CardHeader>
          <CardContent>
            <CostLatencyChart />
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
