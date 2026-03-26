import { useAnimaSymbol } from "@anima/standard-templates";

export default function AnimaSymbol() {
  const frame = useAnimaSymbol(0.6);

  return (
    <pre
      className="font-mono text-[8px] sm:text-[9px] md:text-[10px] leading-[1.2] text-primary/60 select-none whitespace-pre"
      aria-hidden="true"
    >
      {frame.base}
    </pre>
  );
}
