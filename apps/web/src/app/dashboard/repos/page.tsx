import { GitBranch } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { StatePanel } from "@/components/dashboard/state-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPercent, getRepositories } from "@/lib/dashboard-data";

const enabledReviewPasses = ["logic-bugs", "security-bugs", "regression-test-gaps"];

export default async function RepositoriesPage(): Promise<React.ReactElement> {
  const repositories = await getRepositories();

  return (
    <>
      <PageHeader
        title="Connected repositories"
        description="Repository-level controls for rules, confidence thresholds, and maximum findings per pull request."
        actions={
          <Button size="sm" variant="outline">
            <GitBranch data-icon="inline-start" aria-hidden="true" />
            Connect repository
          </Button>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Repo settings</CardTitle>
          <CardDescription>
            Repository settings reported by the API. Review-pass controls are placeholders until per-repo write APIs are added.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {repositories.length === 0 ? (
            <StatePanel
              title="No connected repositories"
              description="Install the GitHub App or record repository installation metadata to manage review settings here."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Rules</TableHead>
                  <TableHead>Min confidence</TableHead>
                  <TableHead>Max findings</TableHead>
                  <TableHead>Enabled passes</TableHead>
                  <TableHead>Last reviewed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {repositories.map((repo) => (
                  <TableRow key={repo.id}>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{repo.repo}</span>
                        <span className="text-xs text-muted-foreground">{repo.installation}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={repo.enabled ? "enabled" : "disabled"} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{repo.rulesPath}</TableCell>
                    <TableCell>
                      <div className="flex min-w-36 flex-col gap-2">
                        <Progress value={repo.confidenceThreshold * 100} />
                        <span className="text-xs text-muted-foreground">
                          {formatPercent(repo.confidenceThreshold)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>{repo.maxFindingsPerPr}</TableCell>
                    <TableCell>
                      <div className="flex max-w-56 flex-wrap gap-1">
                        {enabledReviewPasses.map((pass) => (
                          <span key={pass} className="rounded-md border bg-muted px-2 py-1 text-xs">
                            {pass}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {repo.lastReviewedAt === ""
                        ? "Never"
                        : new Date(repo.lastReviewedAt).toLocaleDateString("en-US")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  );
}
