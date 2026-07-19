import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  XCircle,
  Loader2,
  PhoneCall,
  PhoneOff,
  PhoneMissed,
  Sparkles,
  Clock,
} from "lucide-react";
import type { CallStatus, FieldStatus } from "@/lib/wrenchbid/types";

type Tone = "verified" | "amber" | "muted" | "danger" | "lime" | "cobalt";

const TONE: Record<Tone, string> = {
  verified: "bg-verified/15 text-verified border-verified/40",
  amber: "bg-amber/15 text-amber border-amber/40",
  muted: "bg-muted text-muted-foreground border-border",
  danger: "bg-danger/15 text-danger border-danger/40",
  lime: "bg-lime/15 text-lime border-lime/40",
  cobalt: "bg-cobalt/15 text-[color:var(--cobalt)] border-[color:var(--cobalt)]/40",
};

export function Pill({
  tone = "muted",
  icon,
  children,
  className,
}: {
  tone?: Tone;
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs mono uppercase tracking-wider",
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}

const CALL_MAP: Record<CallStatus, { tone: Tone; icon: React.ReactNode; label: string }> = {
  queued: { tone: "muted", icon: <Clock className="h-3 w-3" />, label: "Queued" },
  ringing: {
    tone: "cobalt",
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
    label: "Connecting",
  },
  connected: { tone: "cobalt", icon: <PhoneCall className="h-3 w-3" />, label: "Connected" },
  collecting_quote: {
    tone: "lime",
    icon: <Sparkles className="h-3 w-3" />,
    label: "Collecting quote",
  },
  waiting_callback: {
    tone: "amber",
    icon: <Clock className="h-3 w-3" />,
    label: "Waiting callback",
  },
  completed: { tone: "verified", icon: <CheckCircle2 className="h-3 w-3" />, label: "Completed" },
  declined: { tone: "danger", icon: <PhoneOff className="h-3 w-3" />, label: "Declined" },
  no_answer: { tone: "amber", icon: <PhoneMissed className="h-3 w-3" />, label: "No answer" },
  failed: { tone: "danger", icon: <XCircle className="h-3 w-3" />, label: "Failed" },
};

export function CallStatusPill({ status }: { status: CallStatus }) {
  const m = CALL_MAP[status];
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {m.label}
    </Pill>
  );
}

const FIELD_MAP: Record<FieldStatus, { tone: Tone; icon: React.ReactNode; label: string }> = {
  verified: { tone: "verified", icon: <CheckCircle2 className="h-3 w-3" />, label: "Verified" },
  needs_confirmation: {
    tone: "amber",
    icon: <AlertTriangle className="h-3 w-3" />,
    label: "Needs confirmation",
  },
  missing: { tone: "muted", icon: <HelpCircle className="h-3 w-3" />, label: "Missing" },
  conflicting: { tone: "danger", icon: <XCircle className="h-3 w-3" />, label: "Conflicting" },
};

export function FieldStatusPill({ status }: { status: FieldStatus }) {
  const m = FIELD_MAP[status];
  return (
    <Pill tone={m.tone} icon={m.icon}>
      {m.label}
    </Pill>
  );
}
