import { KeyRound, Settings2, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { PageHeader } from "@/components/dashboard/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SettingsPage(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="Settings"
        description="Global review controls for models, thresholds, GitHub integration, and API key configuration."
        actions={<Button size="sm">Save settings</Button>}
      />

      <section className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Settings2 aria-hidden="true" />
              <CardTitle>Model settings</CardTitle>
            </div>
            <CardDescription>Configure the default models used by analysis and validation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="analysis-model">Analysis model</Label>
              <Input id="analysis-model" defaultValue="gpt-4.1" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="validator-model">Validator model</Label>
              <Input id="validator-model" defaultValue="gpt-4.1-mini" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="max-tokens">Max output tokens</Label>
              <Input id="max-tokens" type="number" defaultValue="1600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <SlidersHorizontal aria-hidden="true" />
              <CardTitle>Threshold settings</CardTitle>
            </div>
            <CardDescription>Keep comments high-confidence and cap noisy output.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="global-confidence">Global confidence threshold</Label>
              <Input id="global-confidence" type="number" step="0.01" min="0" max="1" defaultValue="0.84" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="default-max-findings">Default max findings per PR</Label>
              <Input id="default-max-findings" type="number" min="1" max="10" defaultValue="5" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="validator-reject-target">Validator rejection target</Label>
              <Input id="validator-reject-target" type="number" step="0.01" defaultValue="0.30" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" />
              <CardTitle>GitHub settings</CardTitle>
            </div>
            <CardDescription>Installation and comment behavior placeholders.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="github-app-slug">GitHub App slug</Label>
              <Input id="github-app-slug" defaultValue="diffguard-ai" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="comment-mode">Comment mode</Label>
              <Input id="comment-mode" defaultValue="Review comments only" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="rules-file">Rules file</Label>
              <Input id="rules-file" defaultValue=".diffguard-rules.md" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <KeyRound aria-hidden="true" />
              <CardTitle>API key configuration</CardTitle>
            </div>
            <CardDescription>Placeholder for secure provider credential setup.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="rounded-md border bg-muted/40 p-4">
              <p className="text-sm font-medium">No secrets are displayed or logged here.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                The production version should store encrypted provider keys server-side and only show
                metadata such as provider, project, creation date, and last-used timestamp.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="provider">Provider</Label>
              <Input id="provider" defaultValue="OpenAI" />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="key-placeholder">API key</Label>
              <Input id="key-placeholder" type="password" value="Configured server-side" readOnly />
            </div>
          </CardContent>
        </Card>
      </section>
    </>
  );
}
