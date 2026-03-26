import { useAnimaSymbol } from "@anima/standard-templates";

export default function AnimaSymbol() {
  const frame = useAnimaSymbol(0.6);

  return (
    <pre
      className="font-mono text-[6px] sm:text-[7px] md:text-[8px] leading-[1.1] text-primary/60 select-none whitespace-pre"
      aria-hidden="true"
    >
      {frame.base}
    </pre>
  );
}
