import { useEffect, useRef } from "react";

export type ImpulsePoint = {
  t: number;
  amplitude: number; // dB
  isHit?: boolean;
  thresholdDb?: number;
};

type Props = {
  points: ImpulsePoint[];
  windowMs: number;
  height?: number;
};

const clampDb = (db: number) => Math.max(-90, Math.min(6, db));

export function ImpulseGraph({ points, windowMs, height = 200 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointsRef = useRef(points);
  pointsRef.current = points;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.clientWidth * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener("resize", resize);

    const render = () => {
      const w = canvas.clientWidth;
      const h = height;
      ctx.clearRect(0, 0, w, h);
      const now = performance.now();
      const start = now - windowMs;

      // background
      const gradient = ctx.createLinearGradient(0, 0, 0, h);
      gradient.addColorStop(0, "#0f1629");
      gradient.addColorStop(1, "#0b1021");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      // time grid every second
      const seconds = Math.floor(windowMs / 1000);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= seconds; i++) {
        const x = w - (i * w) / seconds;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }

      const filtered = pointsRef.current.filter((p) => p.t >= start);
      const ampToY = (db: number) => {
        const normalized = (clampDb(db) + 90) / 90; // 0..1
        return h - normalized * (h * 0.9);
      };

      // threshold line (from last point)
      const last = filtered[filtered.length - 1];
      if (last?.thresholdDb !== undefined) {
        ctx.strokeStyle = "rgba(255,186,73,0.6)";
        ctx.setLineDash([6, 6]);
        const y = ampToY(last.thresholdDb);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // impulses
      filtered.forEach((p) => {
        const x = ((p.t - start) / windowMs) * w;
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

      requestAnimationFrame(render);
    };
    const raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [windowMs, height]);

  return <canvas ref={canvasRef} style={{ width: "100%", height }} />;
}
