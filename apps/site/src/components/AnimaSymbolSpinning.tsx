import { useAnimaSymbolSpinning } from "@anima/standard-templates";

export default function AnimaSymbolSpinning() {
  const frame = useAnimaSymbolSpinning();

  return (
    <pre
      className="font-mono text-[8px] sm:text-[9px] md:text-[10px] leading-[1.15] text-text-muted/40 select-none whitespace-pre"
      aria-hidden="true"
    >
      {frame}
    </pre>
  );
}
