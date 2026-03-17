import type { Greeting } from "../../lib/api";

interface DashboardGreetingProps {
  userName?: string;
  tod: string;
  briefLoading: boolean;
  brief: Greeting | null;
}

export function DashboardGreeting({
  userName,
  tod,
  briefLoading,
  brief,
}: DashboardGreetingProps) {
  return (
    <div className="text-center space-y-4 pt-6 pb-2">
      <div className="space-y-3">
        <p className="font-mono text-[10px] text-text-muted/30 tracking-[0.4em]">
          GOOD {tod.toUpperCase()}
          {userName ? ` // ${userName.split(" ")[0].toUpperCase()}` : ""}
        </p>
        {briefLoading && (
          <div className="flex justify-center gap-2 py-2">
            <span className="w-6 h-px bg-text-muted/20 animate-pulse" />
            <span className="w-6 h-px bg-text-muted/20 animate-pulse [animation-delay:150ms]" />
            <span className="w-6 h-px bg-text-muted/20 animate-pulse [animation-delay:300ms]" />
          </div>
        )}
        {brief && !briefLoading && (
          <p className="text-[14px] text-text/80 leading-relaxed max-w-md mx-auto">
            {brief.message}
          </p>
        )}
        {!brief && !briefLoading && (
          <p className="text-[14px] text-text-muted/40">
            What's on your mind?
          </p>
        )}
      </div>
    </div>
  );
}
