import Link from "next/link";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency, formatDuration, getReviewRuns } from "@/lib/dashboard-data";

export default function ReviewsPage(): React.ReactElement {
  const runs = getReviewRuns();

  return (
    <>
      <PageHeader
        title="Review runs"
        description="Every worker run with status, repository, pull request number, findings count, cost, and latency."
      />

      <Card>
        <CardHeader>
          <CardTitle>Worker queue history</CardTitle>
          <CardDescription>Mock records shaped for the future API response.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Repository</TableHead>
                <TableHead>PR</TableHead>
                <TableHead>Findings</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="font-mono text-xs">{run.id}</TableCell>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="font-medium">{run.repo}</TableCell>
                  <TableCell>#{run.prNumber}</TableCell>
                  <TableCell>
                    {run.findingsCount} / {run.candidatesCount}
                  </TableCell>
                  <TableCell>{formatCurrency(run.costUsd)}</TableCell>
                  <TableCell>{formatDuration(run.latencySeconds)}</TableCell>
                  <TableCell className="text-right">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/dashboard/reviews/${run.id}`}>Details</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
