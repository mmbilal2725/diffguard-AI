"use client";

import {
  ClipboardCheck,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  Settings,
  ShieldCheck
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/reviews", label: "Reviews", icon: GitPullRequest },
  { href: "/dashboard/repos", label: "Repositories", icon: GitBranch },
  { href: "/dashboard/evals", label: "Evals", icon: ClipboardCheck },
  { href: "/settings", label: "Settings", icon: Settings }
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ children }: { children: ReactNode }): React.ReactElement {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-muted/30">
      <aside className="fixed inset-y-0 left-0 hidden w-64 border-r bg-background lg:block">
        <div className="flex h-full flex-col">
          <Link href="/dashboard" className="flex items-center gap-3 border-b px-5 py-5">
            <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold">DiffGuard-AI</span>
              <span className="text-xs text-muted-foreground">Review intelligence</span>
            </div>
          </Link>
          <nav className="flex flex-1 flex-col gap-1 px-3 py-4" aria-label="Dashboard navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active = isActive(pathname, item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
                    active && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground"
                  )}
                >
                  <Icon aria-hidden="true" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t p-4">
            <div className="rounded-md border bg-card p-3">
              <p className="text-xs font-medium text-foreground">Noise budget</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Validator is rejecting 34% of candidate findings before GitHub comments.
              </p>
            </div>
          </div>
        </div>
      </aside>
      <div className="lg:pl-64">
        <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
          <div className="flex min-h-14 items-center justify-between gap-4 px-4 lg:px-8">
            <div className="flex min-w-0 items-center gap-3 lg:hidden">
              <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <ShieldCheck aria-hidden="true" />
              </div>
              <span className="truncate text-sm font-semibold">DiffGuard-AI</span>
            </div>
            <div className="hidden text-sm text-muted-foreground lg:block">
              Low-noise pull request review operations
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border bg-card px-2 py-1">Mock data</span>
              <span className="rounded-md border bg-card px-2 py-1">API-ready UI</span>
            </div>
          </div>
        </div>
        <main className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
