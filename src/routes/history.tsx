import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/wrenchbid/AppShell";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { useEffect, useMemo, useState } from "react";
import { listRequests } from "@/lib/wrenchbid/api";
import type { SessionSummary } from "@/lib/wrenchbid/api-types";

export const Route = createFileRoute("/history")({
  head: () => ({ meta: [{ title: "Session history — WrenchBid" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const sessionMap = useWrenchStore((s) => s.sessions);
  const sessions = Object.values(sessionMap);
  const campaigns = useWrenchStore((s) => s.campaigns);
  const [remoteSessions, setRemoteSessions] = useState<SessionSummary[]>([]);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listRequests()
      .then(setRemoteSessions)
      .catch((reason) =>
        setError(reason instanceof Error ? reason.message : "History unavailable"),
      );
  }, []);

  const allSessions = useMemo(() => {
    const byId = new Map<string, SessionSummary>(sessions.map((session) => [session.id, session]));
    remoteSessions.forEach((session) => byId.set(session.id, session));
    return [...byId.values()].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }, [remoteSessions, sessions]);

  return (
    <AppShell>
      <h1 className="text-3xl font-semibold tracking-tight">Session history</h1>
      <p className="mt-1 text-muted-foreground">
        Live requests are loaded from your private server session; recorded demos remain local.
        Delete a live request from its report page.
      </p>

      <div className="mt-6 grid gap-3">
        {allSessions.length === 0 && (
          <div className="hairline rounded-md bg-surface/40 p-6 text-sm text-muted-foreground">
            No sessions yet. Start a repair request from the home page.
          </div>
        )}
        {allSessions.map((s) => {
          const camp = Object.values(campaigns).find((c) => c.sessionId === s.id);
          const campaignId = camp?.id ?? s.campaignId;
          return (
            <Link
              key={s.id}
              to={campaignId ? "/campaigns/$id" : "/requests/$id/extraction"}
              params={{ id: campaignId ?? s.id }}
              className="hairline flex items-center justify-between rounded-md bg-surface/50 p-4 hover:bg-surface/70"
            >
              <div>
                <div className="mono text-xs uppercase tracking-widest text-lime">
                  {s.mode} · {s.status.replace(/_/g, " ")}
                </div>
                <div className="mt-1 mono text-sm text-muted-foreground">{s.id}</div>
              </div>
              <div className="mono text-xs text-muted-foreground">
                {new Date(s.createdAt).toLocaleString()}
              </div>
            </Link>
          );
        })}
        {error && (
          <div className="rounded-md border border-amber/40 bg-amber/10 p-3 text-sm text-amber">
            {error}
          </div>
        )}
      </div>
    </AppShell>
  );
}
