import type { EvidenceMeta, FieldSource } from "@/lib/wrenchbid/types";
import { FieldStatusPill } from "./StatusPill";
import { cn } from "@/lib/utils";

const SOURCE_LABEL: Record<FieldSource, string> = {
  document: "Document",
  voice: "Voice",
  manual: "Manual",
  seed: "Seed",
};

export function EvidenceField({
  label,
  value,
  meta,
  onEdit,
  mono,
  className,
}: {
  label: string;
  value: React.ReactNode;
  meta: EvidenceMeta;
  onEdit?: () => void;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("hairline rounded-md bg-surface/60 p-3 space-y-1.5", className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs uppercase tracking-wider text-muted-foreground mono">{label}</div>
        <FieldStatusPill status={meta.status} />
      </div>
      <div className={cn("text-lg font-medium", mono && "mono")}>{value}</div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="mono">
          {SOURCE_LABEL[meta.source]} · {Math.round(meta.confidence * 100)}%
        </span>
        {onEdit && (
          <button onClick={onEdit} className="text-lime hover:underline mono">
            Edit
          </button>
        )}
      </div>
      {meta.excerpt && (
        <div className="mt-1 rounded-sm border-l-2 border-lime/50 bg-background/40 px-2 py-1 text-xs text-muted-foreground italic">
          "{meta.excerpt}"
        </div>
      )}
    </div>
  );
}
