import { useEffect, useRef } from "react";

export type ImpulsePoint = {
  id?: string;
  t: number;
  amplitude: number; // dB
  isHit?: boolean;
  thresholdDb?: number;
};

type LabelPosition = "left" | "right";

type Props = {
  points: ImpulsePoint[];
  windowMs: number;
  height?: number;
  metronomeTicks?: {
    startMs: number;
    intervalMs: number;
  };
  minDb?: number;
  maxDb?: number;
  logScale?: boolean;
  horizontalLines?: { value: number; label?: string }[];
  yUnit?: string;
  labelPosition?: LabelPosition;
  showYAxisLabels?: boolean;
  yAxisLabels?: { min?: string; max?: string };
  showThresholdLine?: boolean;
};

export function ImpulseGraph({
  points,
  windowMs,
  height = 200,
  metronomeTicks,
  minDb = -100,
  maxDb = 10,
  logScale = false,
  horizontalLines = [],
  yUnit = "",
  labelPosition = "right",
  showYAxisLabels = true,
  yAxisLabels,
  showThresholdLine = true
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef(points);
  const ticksRef = useRef(metronomeTicks);
  const minDbRef = useRef(minDb);
  const maxDbRef = useRef(maxDb);
  const windowMsRef = useRef(windowMs);
  const logScaleRef = useRef(logScale);
  const horizontalLinesRef = useRef(horizontalLines);
  const labelPositionRef = useRef<LabelPosition>(labelPosition);
  const showYAxisLabelsRef = useRef(showYAxisLabels);
  const yAxisLabelsRef = useRef(yAxisLabels);
  const showThresholdLineRef = useRef(showThresholdLine);
  const heightRef = useRef(height);
  const resizeRef = useRef<(() => void) | null>(null);
  pointsRef.current = points;
  ticksRef.current = metronomeTicks;
  minDbRef.current = minDb;
  maxDbRef.current = maxDb;
  windowMsRef.current = windowMs;
  logScaleRef.current = logScale;
  horizontalLinesRef.current = horizontalLines;
  labelPositionRef.current = labelPosition;
  showYAxisLabelsRef.current = showYAxisLabels;
  yAxisLabelsRef.current = yAxisLabels;
  showThresholdLineRef.current = showThresholdLine;
  heightRef.current = height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = heightRef.current * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resizeRef.current = resize;
    resize();
    window.addEventListener("resize", resize);

    let running = true;
    let rafId = 0;
    const render = () => {
      if (!running) return;
      const w = canvas.clientWidth;
      const h = heightRef.current;
      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const currentWindowMs = windowMsRef.current;
      const start = now - currentWindowMs;

      // background
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "#0f1629");
      gradient.addColorStop(1, "#0b1021");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // time grid aligned to metronome if provided, else per-second grid
      const ticks = ticksRef.current;
      if (ticks && ticks.intervalMs > 0) {
        const { startMs, intervalMs } = ticks;
        const firstTick =
          startMs +
          Math.max(0, Math.ceil((start - startMs) / intervalMs)) * intervalMs;
        ctx.strokeStyle = "rgba(124,93,255,0.35)";
        ctx.lineWidth = 1.5;
        for (let t = firstTick; t <= now; t += intervalMs) {
          const x = ((t - start) / currentWindowMs) * w;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      } else {
        const seconds = Math.floor(currentWindowMs / 1000);
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        for (let i = 0; i <= seconds; i++) {
          const x = w - (i * w) / seconds;
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, h);
          ctx.stroke();
        }
      }

      const filtered = pointsRef.current.filter((p) => p.t >= start);
      const safeMin = Math.min(minDbRef.current, maxDbRef.current - 1);
      const safeMax = Math.max(maxDbRef.current, minDbRef.current + 1);
      const logMin = Math.log2(Math.max(1e-3, safeMin));
      const logMax = Math.log2(Math.max(1e-3, safeMax));
      const rangeLinear = safeMax - safeMin;
      const rangeLog = logMax - logMin || 1;
      const ampToY = (db: number) => {
        const clamped = Math.min(safeMax, Math.max(safeMin, db));
        const normalized = logScaleRef.current
          ? (Math.log2(Math.max(1e-3, clamped)) - logMin) / rangeLog
          : (clamped - safeMin) / rangeLinear;
        return h - normalized * (h * 0.9);
      };

      if (showYAxisLabelsRef.current) {
        const axisLabels = yAxisLabelsRef.current;
        const maxLabel = axisLabels?.max ?? `${safeMax.toFixed(0)}${yUnit}`;
        const minLabel = axisLabels?.min ?? `${safeMin.toFixed(0)}${yUnit}`;
        // Y-axis labels
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.font = "12px sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(maxLabel, 8, 8);
        ctx.textBaseline = "bottom";
        ctx.fillText(minLabel, 8, h - 8);
      }

      // threshold line (from last point)
      const last = filtered[filtered.length - 1];
      if (showThresholdLineRef.current && last?.thresholdDb !== undefined) {
        ctx.strokeStyle = "rgba(255,186,73,0.6)";
        ctx.setLineDash([6, 6]);
        const y = ampToY(last.thresholdDb);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // impulses (vertical bars)
      filtered.forEach((p) => {
        const x = ((p.t - start) / currentWindowMs) * w;
        ctx.strokeStyle = p.isHit ? "#ffba49" : "rgba(60,207,207,0.8)";
        ctx.lineWidth = p.isHit ? 3 : 1.5;
        ctx.beginPath();
        ctx.moveTo(x, h);
        ctx.lineTo(x, ampToY(p.amplitude));
        ctx.stroke();
        if (p.isHit) {
          ctx.fillStyle = "#ffba49";
          ctx.beginPath();
          ctx.arc(x, ampToY(p.amplitude) - 6, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // horizontal reference lines
      horizontalLinesRef.current.forEach((line) => {
        const y = ampToY(line.value);
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);
        if (line.label) {
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.font = "11px sans-serif";
          ctx.textBaseline = "middle";
          const xPos = labelPositionRef.current === "left" ? 8 : w - 140;
          ctx.fillText(line.label, xPos, y);
        }
      });

      rafId = requestAnimationFrame(render);
    };
    rafId = requestAnimationFrame(render);
    return () => {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    resizeRef.current?.();
  }, [height]);

  return <canvas ref={canvasRef} style={{ width: "100%", height }} />;
}
