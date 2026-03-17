import type { FormEvent, RefObject } from "react";

interface DashboardPromptFormProps {
  inputRef: RefObject<HTMLInputElement | null>;
  input: string;
  onInputChange: (value: string) => void;
  onSubmit: (e: FormEvent) => void;
}

export function DashboardPromptForm({
  inputRef,
  input,
  onInputChange,
  onSubmit,
}: DashboardPromptFormProps) {
  return (
    <form onSubmit={onSubmit} className="relative">
      <div className="flex items-center border border-border bg-bg-card px-4 py-3">
        <span className="font-mono text-[10px] text-primary/30 mr-3 select-none">
          &gt;
        </span>
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Talk to ANIMA..."
          className="flex-1 bg-transparent text-sm text-text placeholder:text-text-muted/20 outline-none"
        />
        {input.trim() && (
          <button
            type="submit"
            className="font-mono text-[9px] text-text-muted/40 hover:text-primary transition-colors tracking-wider ml-3"
          >
            SEND
          </button>
        )}
      </div>
    </form>
  );
}
