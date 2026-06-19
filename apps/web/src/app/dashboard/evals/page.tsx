import { EvalQualityChart } from "@/components/dashboard/charts";
import { MetricCard } from "@/components/dashboard/metric-card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { evalRuns, formatCurrency, formatPercent } from "@/lib/dashboard-data";
import { ClipboardCheck, SearchCheck, SearchX, Target } from "lucide-react";

export default function EvalsPage(): React.ReactElement {
  const latest = evalRuns[0];
  if (!latest) {
    throw new Error("Expected at least one eval run for dashboard mock data.");
  }

  const averageCost =
    evalRuns.reduce((total, evalRun) => total + evalRun.costUsd, 0) / evalRuns.length;

  return (
    <>
      <PageHeader
        title="Evaluation results"
        description="Precision, recall, false positives, false negatives, and model cost per eval run."
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          title="Latest precision"
          value={formatPercent(latest.precision)}
          detail="Accepted findings that were true defects"
          icon={Target}
        />
        <MetricCard
          title="Latest recall"
          value={formatPercent(latest.recall)}
          detail="Known defects caught by the reviewer"
          icon={ClipboardCheck}
        />
        <MetricCard
          title="False positives"
          value={String(latest.falsePositives)}
          detail="Noisy findings in the latest eval run"
          icon={SearchX}
        />
        <MetricCard
          title="Avg cost per run"
          value={formatCurrency(averageCost)}
          detail="Mean eval cost across recent runs"
          icon={SearchCheck}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Precision and recall trend</CardTitle>
            <CardDescription>Eval quality over the latest benchmark suites.</CardDescription>
          </CardHeader>
          <CardContent>
            <EvalQualityChart evals={evalRuns} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Eval run history</CardTitle>
            <CardDescription>False positives and false negatives are tracked separately.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Precision</TableHead>
                  <TableHead>Recall</TableHead>
                  <TableHead>FP</TableHead>
                  <TableHead>FN</TableHead>
                  <TableHead>Cost</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {evalRuns.map((evalRun) => (
                  <TableRow key={evalRun.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{evalRun.name}</span>
                        <span className="text-xs text-muted-foreground">{evalRun.cases} cases</span>
                      </div>
                    </TableCell>
                    <TableCell>{formatPercent(evalRun.precision)}</TableCell>
                    <TableCell>{formatPercent(evalRun.recall)}</TableCell>
                    <TableCell>{evalRun.falsePositives}</TableCell>
                    <TableCell>{evalRun.falseNegatives}</TableCell>
                    <TableCell>{formatCurrency(evalRun.costUsd)}</TableCell>
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
