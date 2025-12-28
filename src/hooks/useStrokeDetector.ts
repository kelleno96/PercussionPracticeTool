import { useCallback, useEffect, useRef, useState } from "react";
import type { StrokeEvent } from "../types";

export type DetectorConfig = {
  sensitivity: number; // multiplier on RMS floor
  debounceMs: number;
  minDb: number;
  alpha: number;
  measureWindowMs: number;
};

export const defaultConfig: DetectorConfig = {
  sensitivity: 1.3,
  debounceMs: 15,
  minDb: -60,
  alpha: 0.1,
  measureWindowMs: 30
};

type Telemetry = {
  db: number;
  thresholdDb: number;
  floorDb: number;
};

type StrokeMeasure = {
  seq: number;
  runId?: string;
  rms: number;
  db: number;
  peakDb: number;
};

export function useStrokeDetector(
  onStroke: (stroke: StrokeEvent) => void,
  onTelemetry?: (telemetry: Telemetry) => void,
  onStrokeMeasure?: (measure: StrokeMeasure) => void
) {
  const [isRunning, setIsRunning] = useState(false);
  const [levelDb, setLevelDb] = useState(-120);
  const [config, setConfig] = useState<DetectorConfig>(defaultConfig);
  const [status, setStatus] = useState<"idle" | "permission" | "running" | "error">("idle");
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptNodeRef = useRef<ScriptProcessorNode | null>(null);
  const onStrokeRef = useRef(onStroke);
  const onTelemetryRef = useRef(onTelemetry);
  const onStrokeMeasureRef = useRef(onStrokeMeasure);
  const runIdRef = useRef<string | null>(null);
  const seqRef = useRef(0);
  const floorRef = useRef(0);
  const lastHitRef = useRef(0);

  useEffect(() => {
    onStrokeRef.current = onStroke;
  }, [onStroke]);

  useEffect(() => {
    onTelemetryRef.current = onTelemetry;
  }, [onTelemetry]);

  useEffect(() => {
    onStrokeMeasureRef.current = onStrokeMeasure;
  }, [onStrokeMeasure]);

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
      runIdRef.current = crypto.randomUUID();
      seqRef.current = 0;
      const runId = runIdRef.current;
      setConfig(merged);
      setStatus("permission");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1,
            sampleRate: 48000,
            sampleSize: 24
          }
        });
        const ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
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
              const seq = typeof data.seq === "number" ? data.seq : undefined;
              const strokeRunId = data.runId ?? runIdRef.current ?? undefined;
              const stroke: StrokeEvent = {
                id: crypto.randomUUID(),
                seq,
                runId: strokeRunId,
                at,
                db: data.db,
                peakDb: data.peakDb ?? data.db,
                rms: data.rms,
                thresholdDb: data.thresholdDb,
                floorDb: data.floorDb
              };
              lastHitRef.current = at;
              onStrokeRef.current(stroke);
              setLevelDb(data.db);
            } else if (data.type === "telemetry") {
              setLevelDb(data.db);
              onTelemetryRef.current?.(data);
            } else if (data.type === "stroke-measure") {
              if (typeof data.seq === "number") {
                onStrokeMeasureRef.current?.({
                  seq: data.seq,
                  runId: data.runId ?? runIdRef.current ?? undefined,
                  rms: data.rms,
                  db: data.db,
                  peakDb: data.peakDb
                });
              }
            }
          };
          node.port.postMessage({ type: "config", ...merged, runId });
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
          const measureWindowFrames = Math.max(
            1,
            Math.round((ctx.sampleRate * merged.measureWindowMs) / 1000)
          );
          let pendingMeasure:
            | null
            | {
                seq: number;
                remaining: number;
                sumSquares: number;
                peakAbs: number;
                count: number;
              } = null;
          const accumulateMeasure = (input: Float32Array) => {
            if (!pendingMeasure) return;
            const toProcess = Math.min(pendingMeasure.remaining, input.length);
            for (let i = 0; i < toProcess; i++) {
              const sample = input[i];
              pendingMeasure.sumSquares += sample * sample;
              pendingMeasure.count++;
              const abs = Math.abs(sample);
              if (abs > pendingMeasure.peakAbs) pendingMeasure.peakAbs = abs;
            }
            pendingMeasure.remaining -= toProcess;
            if (pendingMeasure.remaining <= 0) {
              const rmsWindow = Math.sqrt(
                pendingMeasure.sumSquares / Math.max(1, pendingMeasure.count)
              );
              const dbWindow = 20 * Math.log10(rmsWindow + 1e-9);
              const peakDbWindow = 20 * Math.log10(pendingMeasure.peakAbs + 1e-9);
              onStrokeMeasureRef.current?.({
                seq: pendingMeasure.seq,
                runId: runId ?? undefined,
                rms: rmsWindow,
                db: dbWindow,
                peakDb: peakDbWindow
              });
              pendingMeasure = null;
            }
          };
          processor.onaudioprocess = (event) => {
            const input = event.inputBuffer.getChannelData(0);
            let energy = 0;
            let peakAbs = 0;
            for (let i = 0; i < input.length; i++) {
              const sample = input[i];
              energy += sample * sample;
              const abs = Math.abs(sample);
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
              const seq = ++seqRef.current;
              const stroke: StrokeEvent = {
                id: crypto.randomUUID(),
                seq,
                runId: runId ?? undefined,
                at: now,
                db,
                peakDb,
                rms,
                thresholdDb,
                floorDb
              };
              onStrokeRef.current(stroke);
              pendingMeasure = {
                seq,
                remaining: measureWindowFrames,
                sumSquares: 0,
                peakAbs: 0,
                count: 0
              };
              accumulateMeasure(input);
            } else {
              accumulateMeasure(input);
            }
            setLevelDb(db);
            onTelemetryRef.current?.({ db, thresholdDb, floorDb });
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
    [config, isRunning]
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
