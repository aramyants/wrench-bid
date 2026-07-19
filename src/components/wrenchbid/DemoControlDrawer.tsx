import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useWrenchStore } from "@/lib/wrenchbid/store";
import { useNavigate } from "@tanstack/react-router";
import { DEMO_CAMPAIGN_ID, DEMO_SESSION_ID, DEMO_SPEC_ID } from "@/lib/wrenchbid/seed";
import { toast } from "sonner";

export function DemoControlDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const s = useWrenchStore();
  const navigate = useNavigate();

  const groups: Array<{
    label: string;
    items: Array<{ label: string; run: () => void; tone?: "danger" | "warning" | "default" }>;
  }> = [
    {
      label: "Session",
      items: [
        {
          label: "Reset seeded demo",
          run: () => {
            s.resetDemo();
            toast.success("Demo reset");
          },
        },
        {
          label: "Open Agent Arena",
          run: () => {
            s.ensureSeeded();
            onOpenChange(false);
            navigate({ to: "/demo/arena" });
          },
        },
        {
          label: "Open completed workflow",
          run: () => {
            s.ensureSeeded();
            onOpenChange(false);
            navigate({ to: "/campaigns/$id", params: { id: DEMO_CAMPAIGN_ID } });
          },
        },
        {
          label: "Start a new blank request",
          run: () => {
            const r = s.createSession("demo");
            onOpenChange(false);
            navigate({ to: "/requests/$id/extraction", params: { id: r.sessionId } });
          },
        },
      ],
    },
    {
      label: "Extraction & Intake",
      items: [
        {
          label: "Correct mileage 52k → 62k",
          run: () => {
            s.correctMileage(DEMO_SPEC_ID, 62000);
            toast.success("Mileage corrected");
          },
        },
        {
          label: "Confirm RepairSpec",
          run: async () => {
            await s.confirmSpec(DEMO_SPEC_ID);
            toast.success("Spec confirmed");
          },
        },
      ],
    },
    {
      label: "Campaign",
      items: [
        {
          label: "Advance all calls one step",
          run: () => {
            const calls = Object.values(s.calls).filter((c) => c.campaignId === DEMO_CAMPAIGN_ID);
            calls.forEach((c) => s.advanceCall(c.id));
          },
        },
        {
          label: "Simulate hidden-fee discovery",
          run: () => {
            s.revealHiddenFee();
            toast.info("Hidden fee flagged on Budget Brake quote");
          },
        },
        {
          label: "Simulate no-answer (Queen City)",
          run: () => {
            const c = Object.values(s.calls).find((x) => x.shopId === "shop_queencity");
            if (c) s.simulateNoAnswer(c.id);
          },
          tone: "warning",
        },
      ],
    },
    {
      label: "Negotiation",
      items: [
        {
          label: "Apply negotiated revision",
          run: () => {
            s.applyNegotiation(["beat_or_match", "waive_shop_supply"]);
            toast.success("Revised offer applied");
          },
        },
        {
          label: "Open final report",
          run: () => {
            onOpenChange(false);
            navigate({ to: "/campaigns/$id/report", params: { id: DEMO_CAMPAIGN_ID } });
          },
        },
      ],
    },
    {
      label: "Danger",
      items: [
        {
          label: "Delete demo session",
          run: () => {
            s.deleteSession(DEMO_SESSION_ID);
            toast.warning("Demo session deleted");
          },
          tone: "danger",
        },
      ],
    },
  ];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="mono uppercase tracking-widest text-lime text-xs">
            Demo Control Drawer
          </SheetTitle>
          <SheetDescription>
            Scripted state transitions for presentation. Not visible in normal production mode.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-6 space-y-6 px-4 pb-8">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="mono mb-2 text-[10px] uppercase tracking-widest text-muted-foreground">
                {g.label}
              </div>
              <div className="grid gap-2">
                {g.items.map((it) => (
                  <Button
                    key={it.label}
                    variant={it.tone === "danger" ? "destructive" : "secondary"}
                    className="justify-start text-left"
                    onClick={() => it.run()}
                  >
                    {it.label}
                  </Button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
