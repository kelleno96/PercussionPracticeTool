import { useCallback, useEffect, useRef, useState } from "react";
import type { StrokeEvent } from "../types";

export type DetectorConfig = {
  sensitivity: number; // multiplier on RMS floor
  debounceMs: number;
  minDb: number;
  alpha: number;
};

const defaultConfig: DetectorConfig = {
  sensitivity: 1.5,
  debounceMs: 35,
  minDb: -55,
  alpha: 0.05
};

type Telemetry = {
  db: number;
  thresholdDb: number;
  floorDb: number;
};

export function useStrokeDetector(
  onStroke: (stroke: StrokeEvent) => void,
  onTelemetry?: (telemetry: Telemetry) => void
) {
  const [isRunning, setIsRunning] = useState(false);
  const [levelDb, setLevelDb] = useState(-120);
  const [config, setConfig] = useState<DetectorConfig>(defaultConfig);
  const [status, setStatus] = useState<"idle" | "permission" | "running" | "error">("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const floorRef = useRef(0);
  const lastHitRef = useRef(0);

  const stop = useCallback(() => {
    setIsRunning(false);
    setStatus("idle");
    workletNodeRef.current?.port?.close();
    workletNodeRef.current?.disconnect();
    scriptNodeRef.current?.disconnect();
    ctxRef.current?.close();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    workletNodeRef.current = null;
    scriptNodeRef.current = null;
    ctxRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  useEffect(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ type: "config", ...config });
    }
  }, [config]);

  const start = useCallback(
    async (customConfig?: Partial<DetectorConfig>) => {
      if (isRunning) return;
      const merged = { ...config, ...customConfig };
      setConfig(merged);
      setStatus("permission");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1
          }
        });
        const ctx = new AudioContext({ latencyHint: "interactive" });
        streamRef.current = stream;
        ctxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        let connected = false;
        try {
          await ctx.audioWorklet.addModule("/worklets/stroke-processor.js");
          const silent = ctx.createGain();
          silent.gain.value = 0;
          const node = new AudioWorkletNode(ctx, "stroke-processor", {
            numberOfInputs: 1,
            outputChannelCount: [1]
          });
          node.port.onmessage = (event) => {
            const data = event.data;
            if (data.type === "stroke") {
              const at = performance.now();
              const stroke: StrokeEvent = {
                id: crypto.randomUUID(),
                at,
                db: data.db,
                peakDb: data.peakDb ?? data.db,
                rms: data.rms,
                thresholdDb: data.thresholdDb,
                floorDb: data.floorDb
              };
              lastHitRef.current = at;
              onStroke(stroke);
              setLevelDb(data.db);
            } else if (data.type === "telemetry") {
              setLevelDb(data.db);
              onTelemetry?.(data);
            }
          };
          node.port.postMessage({ type: "config", ...merged });
          source.connect(node);
          node.connect(silent).connect(ctx.destination);
          workletNodeRef.current = node;
          connected = true;
        } catch (err) {
          console.warn("AudioWorklet unavailable, using ScriptProcessor fallback", err);
        }

        if (!connected) {
          const processor = ctx.createScriptProcessor(1024, 1, 1);
          const silent = ctx.createGain();
          silent.gain.value = 0;
          processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            let energy = 0;
            let peakAbs = 0;
            for (let i = 0; i < input.length; i++) {
              energy += input[i] * input[i];
              const abs = Math.abs(input[i]);
              if (abs > peakAbs) peakAbs = abs;
            }
            const rms = Math.sqrt(energy / input.length);
            floorRef.current = merged.alpha * rms + (1 - merged.alpha) * floorRef.current;
            const floorDb = 20 * Math.log10(floorRef.current + 1e-9);
            const db = 20 * Math.log10(rms + 1e-9);
            const peakDb = 20 * Math.log10(peakAbs + 1e-9);
            const thresholdDb = Math.max(floorDb + merged.sensitivity * 6, merged.minDb);
            const now = performance.now();
            if (db > thresholdDb && now - lastHitRef.current > merged.debounceMs) {
              lastHitRef.current = now;
              const stroke: StrokeEvent = {
                id: crypto.randomUUID(),
                at: now,
                db,
                peakDb,
                rms,
                thresholdDb,
                floorDb
              };
              onStroke(stroke);
            }
            setLevelDb(db);
            onTelemetry?.({ db, thresholdDb, floorDb });
          };
          source.connect(processor);
          processor.connect(silent).connect(ctx.destination);
          scriptNodeRef.current = processor;
        }

        setIsRunning(true);
        setStatus("running");
      } catch (err) {
        console.error("Failed to start detector", err);
        setStatus("error");
      }
    },
    [config, isRunning, onStroke, onTelemetry]
  );

  return {
    isRunning,
    status,
    levelDb,
    config,
    start,
    stop,
    updateConfig: (next: Partial<DetectorConfig>) => setConfig((prev) => ({ ...prev, ...next }))
  };
}
