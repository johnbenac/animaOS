import { useAnimaSymbol } from "@anima/standard-templates";

export default function AnimaSymbol() {
  const frame = useAnimaSymbol(0.6);

  return (
    <pre
      className="font-mono text-[7px] sm:text-[8px] md:text-[9px] leading-[1.15] text-text/30 select-none whitespace-pre"
      aria-hidden="true"
    >
      {frame.base}
    </pre>
  );
}
