import { notFound } from "next/navigation";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatCurrency,
  formatDuration,
  formatPercent,
  getReviewRunById
} from "@/lib/dashboard-data";

export default async function ReviewDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}): Promise<React.ReactElement> {
  const { id } = await params;
  const run = getReviewRunById(id);

  if (!run) {
    notFound();
  }

  return (
    <>
      <PageHeader
        title={`${run.repo} #${run.prNumber}`}
        description={run.title}
        actions={
          <>
            <StatusBadge status={run.status} />
            <StatusBadge status={run.githubCommentStatus} />
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Findings posted</CardDescription>
            <CardTitle className="text-2xl">{run.findingsCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{run.candidatesCount} candidates analyzed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Confidence threshold</CardDescription>
            <CardTitle className="text-2xl">{formatPercent(run.confidenceThreshold)}</CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={run.confidenceThreshold * 100} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Cost</CardDescription>
            <CardTitle className="text-2xl">{formatCurrency(run.costUsd)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Tracked across all model calls</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Latency</CardDescription>
            <CardTitle className="text-2xl">{formatDuration(run.latencySeconds)}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Webhook received to final decision</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Findings</CardTitle>
          <CardDescription>High-confidence issues selected for GitHub review comments.</CardDescription>
        </CardHeader>
        <CardContent>
          {run.findings.length ? (
            <div className="flex flex-col gap-3">
              {run.findings.map((finding) => (
                <div key={finding.id} className="rounded-md border p-4">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="flex flex-col gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{finding.severity}</Badge>
                        <StatusBadge status={finding.status} />
                        <span className="font-mono text-xs text-muted-foreground">
                          {finding.file}:{finding.line}
                        </span>
                      </div>
                      <h2 className="text-base font-semibold">{finding.title}</h2>
                      <p className="text-sm text-muted-foreground">{finding.summary}</p>
                    </div>
                    <div className="min-w-32">
                      <p className="mb-2 text-xs text-muted-foreground">Confidence</p>
                      <Progress value={finding.confidence * 100} />
                      <p className="mt-1 text-xs font-medium">{formatPercent(finding.confidence)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-md border bg-muted/40 p-6 text-sm text-muted-foreground">
              No findings were posted for this review run.
            </div>
          )}
        </CardContent>
      </Card>

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Validator decisions</CardTitle>
            <CardDescription>Accepted, rejected, and deduplicated model findings.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Finding</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Confidence</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.validatorDecisions.map((decision) => (
                  <TableRow key={decision.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{decision.finding}</span>
                        <span className="text-xs text-muted-foreground">{decision.reason}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={decision.decision} />
                    </TableCell>
                    <TableCell>{formatPercent(decision.confidence)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Model calls</CardTitle>
            <CardDescription>Cost, token usage, model name, and latency by pipeline stage.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Purpose</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Tokens</TableHead>
                  <TableHead>Cost</TableHead>
                  <TableHead>Latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.modelCalls.map((call) => (
                  <TableRow key={call.id}>
                    <TableCell className="font-medium">{call.purpose}</TableCell>
                    <TableCell>{call.model}</TableCell>
                    <TableCell>{call.inputTokens + call.outputTokens}</TableCell>
                    <TableCell>{formatCurrency(call.costUsd)}</TableCell>
                    <TableCell>{formatDuration(Math.round(call.latencyMs / 1000))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
