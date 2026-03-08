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
      <input
        ref={inputRef}
        type="text"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        placeholder="Talk to ANIMA..."
        className="w-full bg-(--color-bg-card) border border-(--color-border) rounded-xl px-5 py-3.5 text-sm text-(--color-text) placeholder:text-(--color-text-muted)/25 outline-none focus:border-(--color-text-muted)/30 transition-all"
      />
      {input.trim() && (
        <button
          type="submit"
          className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-(--color-primary) hover:text-(--color-text) transition-colors"
        >
          &rarr;
        </button>
      )}
    </form>
  );
}
