import type { Nudge } from "../../lib/api";

interface DashboardNudgesProps {
  nudges: Nudge[];
  onDismiss: (type: string) => void;
}

export function DashboardNudges({ nudges, onDismiss }: DashboardNudgesProps) {
  if (!nudges.length) return null;

  return (
    <div className="space-y-1">
      {nudges.map((nudge) => (
        <div
          key={nudge.type}
          className="flex items-center justify-between gap-3 px-4 py-2.5 bg-bg-card border-l-2 border-primary/20"
        >
          <span className="text-xs text-text-muted">{nudge.message}</span>
          <button
            onClick={() => onDismiss(nudge.type)}
            className="font-mono text-[9px] text-text-muted/30 hover:text-text-muted shrink-0 tracking-wider"
          >
            DISMISS
          </button>
        </div>
      ))}
    </div>
  );
}
