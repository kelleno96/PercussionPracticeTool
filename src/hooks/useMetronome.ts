import { useCallback, useEffect, useRef, useState } from "react";

export type MetronomeConfig = {
  tempo: number;
  subdivision: number;
  volume: number;
};

const createClick = (ctx: AudioContext, time: number, accent = false, volume = 0.6) => {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = accent ? 1200 : 850;
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(volume, time + 0.001);
  gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.08);
  osc.connect(gain).connect(ctx.destination);
  osc.start(time);
  osc.stop(time + 0.1);
};

export function useMetronome(initial: MetronomeConfig) {
  const [config, setConfig] = useState(initial);
  const [isRunning, setIsRunning] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const nextNoteTimeRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const beatCountRef = useRef(0);
  const configRef = useRef(config);
  configRef.current = config;

  const schedule = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    const localConfig = configRef.current;
    const lookahead = 0.1; // seconds
    while (nextNoteTimeRef.current < ctx.currentTime + lookahead) {
      const isAccent = beatCountRef.current % localConfig.subdivision === 0;
      createClick(ctx, nextNoteTimeRef.current, isAccent, localConfig.volume);
      const secondsPerBeat = 60 / localConfig.tempo / localConfig.subdivision;
      nextNoteTimeRef.current += secondsPerBeat;
      beatCountRef.current++;
    }
    rafRef.current = requestAnimationFrame(schedule);
  }, []);

  const start = useCallback(async () => {
    if (isRunning) return;
    const ctx = new AudioContext({ latencyHint: "interactive" });
    ctxRef.current = ctx;
    await ctx.resume();
    nextNoteTimeRef.current = ctx.currentTime + 0.05;
    beatCountRef.current = 0;
    setIsRunning(true);
    rafRef.current = requestAnimationFrame(schedule);
  }, [isRunning, schedule]);

  const stop = useCallback(() => {
    setIsRunning(false);
    rafRef.current && cancelAnimationFrame(rafRef.current);
    ctxRef.current?.close();
    ctxRef.current = null;
  }, []);

  useEffect(() => () => stop(), [stop]);

  return {
    isRunning,
    config,
    start,
    stop,
    setTempo: (tempo: number) => setConfig((prev) => ({ ...prev, tempo })),
    setSubdivision: (subdivision: number) => setConfig((prev) => ({ ...prev, subdivision })),
    setVolume: (volume: number) => setConfig((prev) => ({ ...prev, volume }))
  };
}
