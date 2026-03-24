// Current version: 44x22 grid with layered shimmer, edge glow, sparkle halo + inner ring
import { useState, useEffect, useRef } from "react";
import { LOGO_SVG_PATH, DENSITY, SPARKLE_CHARS, hash } from "./constants";

export function useAnimaSymbol(speed = 1) {
  const [frame, setFrame] = useState("");
  const alphaRef = useRef<number[][]>([]);
  const readyRef = useRef(false);
  const tRef = useRef(0);
  const speedRef = useRef(speed);
  useEffect(() => { speedRef.current = speed; }, [speed]);

  useEffect(() => {
    const rasterW = 200;
    const rasterH = 206;
    const canvas = document.createElement("canvas");
    canvas.width = rasterW;
    canvas.height = rasterH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const path = new Path2D(LOGO_SVG_PATH);
    ctx.scale(rasterW / 36, rasterH / 37);
    ctx.fillStyle = "white";
    ctx.fill(path);

    const imageData = ctx.getImageData(0, 0, rasterW, rasterH);

    const cols = 44;
    const rows = 22;
    const cellW = rasterW / cols;
    const cellH = rasterH / rows;
    const alpha: number[][] = [];

    for (let r = 0; r < rows; r++) {
      alpha[r] = [];
      for (let c = 0; c < cols; c++) {
        let sum = 0;
        let count = 0;
        const y0 = Math.floor(r * cellH);
        const y1 = Math.min(rasterH, Math.floor((r + 1) * cellH));
        const x0 = Math.floor(c * cellW);
        const x1 = Math.min(rasterW, Math.floor((c + 1) * cellW));
        for (let py = y0; py < y1; py++) {
          for (let px = x0; px < x1; px++) {
            sum += imageData.data[(py * rasterW + px) * 4 + 3];
            count++;
          }
        }
        alpha[r][c] = count > 0 ? sum / count / 255 : 0;
      }
    }

    alphaRef.current = alpha;
    readyRef.current = true;
  }, []);

  useEffect(() => {
    const render = () => {
      if (!readyRef.current) return;
      const alpha = alphaRef.current;
      const rows = alpha.length;
      const cols = alpha[0].length;
      const t = tRef.current;

      const padX = 5;
      const padY = 2;
      const totalCols = cols + padX * 2;
      const totalRows = rows + padY * 2;
      const cx = totalCols / 2;
      const cy = totalRows / 2;

      let result = "";

      for (let fy = 0; fy < totalRows; fy++) {
        for (let fx = 0; fx < totalCols; fx++) {
          const ar = fy - padY;
          const ac = fx - padX;
          const inLogo = ar >= 0 && ar < rows && ac >= 0 && ac < cols;
          const a = inLogo ? alpha[ar][ac] : 0;

          if (a > 0.08) {
            const w1 = Math.sin(fx * 0.2 - t * 0.08 + fy * 0.15) * 0.5 + 0.5;
            const w2 = Math.sin(fx * 0.09 + t * 0.11 - fy * 0.35) * 0.5 + 0.5;
            const w3 = Math.cos((fx + fy) * 0.12 + t * 0.05) * 0.5 + 0.5;
            const pulse = Math.sin(t * 0.025) * 0.12 + 0.88;
            const flick = hash(fx, fy, t % 47) > 0.92 ? 0.22 : 0;
            const combined = w1 * 0.4 + w2 * 0.35 + w3 * 0.25;
            const brightness = Math.min(
              1,
              a * (0.5 + 0.5 * combined) * pulse + flick,
            );
            const idx = Math.floor(brightness * (DENSITY.length - 1));
            result += DENSITY[Math.max(0, Math.min(DENSITY.length - 1, idx))];
          } else if (inLogo && a > 0.01) {
            const edgePulse =
              Math.sin(fx * 0.3 + fy * 0.2 - t * 0.06) * 0.5 + 0.5;
            if (edgePulse > 0.6 && hash(fx, fy, t % 29) > 0.5) {
              result += ".";
            } else {
              result += " ";
            }
          } else {
            const dx = (fx - cx) / cx;
            const dy = (fy - cy) / cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const angle = Math.atan2(dy, dx);

            const petals = Math.cos((angle - t * 0.025) * 6) * 0.5 + 0.5;
            const bloom = Math.sin(t * 0.035) * 0.18 + 0.72;
            const ring = 1 - Math.abs(dist - bloom) * 3.5;
            const intensity = Math.max(0, ring) * petals;

            const innerBloom = Math.sin(t * 0.05 + 1.5) * 0.1 + 0.4;
            const innerRing = 1 - Math.abs(dist - innerBloom) * 5;
            const innerIntensity = Math.max(0, innerRing) * 0.4;

            const totalIntensity = Math.max(intensity, innerIntensity);
            const rng = hash(fx, fy, Math.floor(t * 0.22));

            if (totalIntensity > 0.5 && rng > 0.55) {
              const si = Math.floor(
                hash(fx, fy, t % 31) * SPARKLE_CHARS.length,
              );
              result += SPARKLE_CHARS[si];
            } else if (totalIntensity > 0.25 && rng > 0.75) {
              result += "·";
            } else if (
              dist < 1.15 &&
              hash(fx, fy, Math.floor(t * 0.12)) > 0.95
            ) {
              result += "·";
            } else {
              result += " ";
            }
          }
        }
        result += "\n";
      }

      setFrame(result);
      tRef.current += speedRef.current;
    };

    const interval = setInterval(render, 55);
    return () => clearInterval(interval);
  }, []);

  return frame;
}
