import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { DemoControlDrawer } from "./DemoControlDrawer";
import { cn } from "@/lib/utils";

export function AppShell({ children, replayLabel }: { children: ReactNode; replayLabel?: string }) {
  const [demoOpen, setDemoOpen] = useState(false);
  const showDemoTools = import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE === "true";
  return (
    <div className="min-h-screen bg-background text-foreground grid-bg">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-6">
          <Link to="/" className="flex items-center gap-2 group">
            <LogoMark />
            <span className="font-semibold tracking-tight">WrenchBid</span>
            <span className="ml-2 hidden text-xs text-muted-foreground md:inline">
              One repair. Three shops. One negotiated deal.
            </span>
          </Link>
          <nav className="flex items-center gap-2 text-sm">
            {showDemoTools && (
              <Link to="/demo" className="rounded-md px-3 py-1.5 hover:bg-secondary">
                Recorded demo
              </Link>
            )}
            <Link
              to="/history"
              className="hidden rounded-md px-3 py-1.5 hover:bg-secondary md:inline"
            >
              History
            </Link>
            {showDemoTools && (
              <button
                onClick={() => setDemoOpen(true)}
                className={cn(
                  "rounded-md border border-lime/40 bg-lime/10 px-3 py-1.5 text-lime hover:bg-lime/20",
                  "mono text-xs tracking-wider uppercase",
                )}
              >
                Demo controls
              </button>
            )}
          </nav>
        </div>
        {replayLabel && (
          <div className="border-b border-amber/30 bg-amber/10 px-4 py-1.5 text-center text-xs mono uppercase tracking-widest text-amber">
            {replayLabel}
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 md:px-6 md:py-10">{children}</main>
      <DemoControlDrawer open={demoOpen} onOpenChange={setDemoOpen} />
      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        <span className="mono">
          All numbers labelled <span className="text-lime">demo</span> are synthetic. WrenchBid does
          not diagnose repairs.
        </span>
      </footer>
    </div>
  );
}

function LogoMark() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" className="text-lime">
      <path
        d="M4 12 L10 6 L14 10 L20 4 L20 10 L14 16 L10 12 L4 18 Z"
        fill="currentColor"
        opacity="0.9"
      />
      <circle cx="20" cy="4" r="1.5" fill="currentColor" />
    </svg>
  );
}
