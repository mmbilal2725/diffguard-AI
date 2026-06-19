import { Activity, CheckCircle2, GitPullRequest, ShieldCheck, Timer, XCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const metrics = [
  { label: "Findings posted", value: "128", detail: "High-confidence comments only" },
  { label: "Validator rejection", value: "31%", detail: "Noisy model output blocked" },
  { label: "Resolution rate", value: "74%", detail: "Posted findings marked resolved" },
  { label: "Avg latency", value: "46s", detail: "Diff to completed review run" }
];

const recentRuns = [
  {
    repo: "acme/payments",
    pr: "#482",
    status: "Completed",
    findings: "3 posted",
    cost: "$0.42"
  },
  {
    repo: "northstar/api",
    pr: "#117",
    status: "Validating",
    findings: "2 candidates",
    cost: "$0.18"
  },
  {
    repo: "atlas/web",
    pr: "#903",
    status: "Rejected",
    findings: "0 posted",
    cost: "$0.09"
  }
];

const qualitySignals = [
  "Repo rules loaded from .diffguard-rules.md",
  "Static checks complete before model review",
  "Second-pass validator rejects weak findings",
  "Deduplication groups repeated comments"
];

export default function DashboardPage(): React.ReactElement {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8 px-6 py-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b pb-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ShieldCheck aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">DiffGuard-AI</h1>
              <p className="text-sm text-muted-foreground">Pull request review quality dashboard</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="secondary">Foundation scaffold</Badge>
            <Button variant="outline" size="sm">
              <GitPullRequest data-icon="inline-start" aria-hidden="true" />
              Review queue
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="Review metrics">
          {metrics.map((metric) => (
            <Card key={metric.label}>
              <CardHeader>
                <CardDescription>{metric.label}</CardDescription>
                <CardTitle className="text-3xl">{metric.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">{metric.detail}</p>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <Card>
            <CardHeader>
              <CardTitle>Recent review runs</CardTitle>
              <CardDescription>Static placeholder data for the initial dashboard shell.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-left text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Repository</th>
                      <th className="px-4 py-3 font-medium">PR</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Findings</th>
                      <th className="px-4 py-3 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRuns.map((run) => (
                      <tr key={`${run.repo}-${run.pr}`} className="border-t">
                        <td className="px-4 py-3 font-medium">{run.repo}</td>
                        <td className="px-4 py-3 text-muted-foreground">{run.pr}</td>
                        <td className="px-4 py-3">
                          <Badge variant={run.status === "Rejected" ? "outline" : "secondary"}>
                            {run.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{run.findings}</td>
                        <td className="px-4 py-3 text-muted-foreground">{run.cost}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Pipeline shape</CardTitle>
                <CardDescription>Foundation modules are ready for the review workflow.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {qualitySignals.map((signal, index) => (
                  <div key={signal} className="flex items-start gap-3">
                    <div className="mt-0.5 flex size-6 items-center justify-center rounded-md bg-secondary">
                      <span className="text-xs font-semibold">{index + 1}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">{signal}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quality controls</CardTitle>
                <CardDescription>Metrics that keep comments useful and low-noise.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <CheckCircle2 aria-hidden="true" />
                    Validator pass rate
                  </span>
                  <span className="text-sm font-medium">69%</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <XCircle aria-hidden="true" />
                    False positive reports
                  </span>
                  <span className="text-sm font-medium">4</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <Timer aria-hidden="true" />
                    Cost this week
                  </span>
                  <span className="text-sm font-medium">$18.72</span>
                </div>
                <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="flex items-center gap-2 text-sm">
                    <Activity aria-hidden="true" />
                    Active repositories
                  </span>
                  <span className="text-sm font-medium">12</span>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
