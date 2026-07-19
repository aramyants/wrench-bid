import { useEffect, useState } from "react";
import { getCampaign, getRequest } from "@/lib/wrenchbid/api";
import { useWrenchStore } from "@/lib/wrenchbid/store";

export function useRequestSync(sessionId: string) {
  const hydrated = useWrenchStore((state) => state.hydrated);
  const session = useWrenchStore((state) => state.sessions[sessionId]);
  const merge = useWrenchStore((state) => state.mergeRequestSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!hydrated || session?.mode === "demo") return;
    let cancelled = false;
    setLoading(true);
    getRequest(sessionId)
      .then((snapshot) => {
        if (!cancelled) merge(snapshot);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Request unavailable");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [hydrated, merge, session?.mode, sessionId]);

  return { loading, error };
}

export function useCampaignSync(campaignId: string, poll = true) {
  const hydrated = useWrenchStore((state) => state.hydrated);
  const campaign = useWrenchStore((state) => state.campaigns[campaignId]);
  const merge = useWrenchStore((state) => state.mergeCampaignSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!hydrated || campaign?.mode === "replay") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      setLoading(true);
      try {
        const snapshot = await getCampaign(campaignId);
        if (cancelled) return;
        merge(snapshot);
        setError(undefined);
        if (poll) {
          timer = setTimeout(refresh, 4_000);
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Campaign unavailable");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void refresh();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [campaign?.mode, campaignId, hydrated, merge, poll]);

  return { loading, error };
}
