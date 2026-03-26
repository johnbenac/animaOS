import { useAnimaSymbolSpinning } from "@anima/standard-templates";

export default function AnimaSymbolSpinning() {
  const frame = useAnimaSymbolSpinning();

  return (
    <pre
      className="font-mono text-[10px] sm:text-[12px] md:text-[14px] leading-[1.2] text-text-muted select-none whitespace-pre"
      aria-hidden="true"
    >
      {frame}
    </pre>
  );
}
