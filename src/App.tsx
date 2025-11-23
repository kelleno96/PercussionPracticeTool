import React, { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ImpulseGraph, type ImpulsePoint } from "./components/ImpulseGraph";
import { useStrokeDetector } from "./hooks/useStrokeDetector";
import { useMetronome } from "./hooks/useMetronome";
import { addExercise, appendStrokeEvent, listExercises, listSessions, persistSession } from "./services/api";
import {
  aggregateExerciseTotals,
  peakSpm,
  strokesByPeriod,
  streakDays,
  summarizeSessions,
  weeklyTotals
} from "./analytics";
import type { Session, StrokeEvent } from "./types";
import { clearLocalData } from "./services/api";

const formatMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatNumber = (n: number) => n.toLocaleString();

const readCookie = (name: string) => {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  if (!match) return null;
  return decodeURIComponent(match.split("=")[1] ?? "");
};

const writeCookie = (name: string, value: string, days = 180) => {
  if (typeof document === "undefined") return;
  const expires = new Date(Date.now() + days * 86_400_000).toUTCString();
  document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
};

function App() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [exerciseOptions, setExerciseOptions] = useState<{ id: string; name: string }[]>([]);
  const [exerciseId, setExerciseId] = useState<string>("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [impulses, setImpulses] = useState<ImpulsePoint[]>([]);
  const [timeWindowMs, setTimeWindowMs] = useState(5000);
  const [logging, setLogging] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [thresholdDb, setThresholdDb] = useState(-40);
  const [liveCount, setLiveCount] = useState(0);
  const currentSessionRef = useRef<string | null>(null);
  const autoStartedMicRef = useRef(false);
  const [metronomeAnchorMs, setMetronomeAnchorMs] = useState<number | null>(null);
  const [avOffsetMs, setAvOffsetMs] = useState(() => {
    const saved = readCookie("stroke-counter-av-offset");
    return saved ? Number(saved) || 0 : 0;
  });
  const [showCalibration, setShowCalibration] = useState(false);
  const displayDbRef = useRef(-90);

  const metronome = useMetronome({ tempo: 110, subdivision: 1, volume: 0.6 });

  useEffect(() => {
    currentSessionRef.current = currentSessionId;
  }, [currentSessionId]);

  const { isRunning, status, levelDb, config, start, stop, updateConfig } = useStrokeDetector(
    useCallback(
      (stroke: StrokeEvent) => {
        const sessionId = currentSessionRef.current;
        setThresholdDb(stroke.thresholdDb);
        setImpulses((prev) => {
          const now = performance.now();
          const next = [
            ...prev,
            {
              t: now,
              amplitude: stroke.peakDb ?? stroke.db,
              isHit: true,
              thresholdDb: stroke.thresholdDb
            }
          ].filter((p) => p.t >= now - timeWindowMs);
          return next;
        });
        if (sessionId) {
          const session = sessions.find((s) => s.id === sessionId);
          setSessions((prev) =>
            prev.map((s) => (s.id === sessionId ? { ...s, strokes: [...s.strokes, stroke] } : s))
          );
      appendStrokeEvent(sessionId, { ...stroke, exerciseId }, session?.userId);
      setLiveCount((c) => c + 1);
    }
      },
      [exerciseId, timeWindowMs, metronomeAnchorMs, sessions]
    ),
    useCallback(
      (telemetry) => {
        setThresholdDb(telemetry.thresholdDb);
        displayDbRef.current = 0.85 * displayDbRef.current + 0.15 * telemetry.db;
        setImpulses((prev) => {
          const now = performance.now();
          const next = [
            ...prev,
            { t: now, amplitude: displayDbRef.current, thresholdDb: telemetry.thresholdDb }
          ].filter((p) => p.t >= now - timeWindowMs);
          return next;
        });
      },
      [timeWindowMs]
    )
  );

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    writeCookie("stroke-counter-av-offset", String(avOffsetMs));
  }, [avOffsetMs]);

  useEffect(() => {
    (async () => {
      const loadedSessions = await listSessions();
      setSessions(loadedSessions);
      const exercises = listExercises();
      setExerciseOptions(exercises);
      setExerciseId(exercises[0]?.id ?? "");
    })();
  }, []);

  useEffect(() => {
    if (!isRunning && !autoStartedMicRef.current) {
      autoStartedMicRef.current = true;
      start().catch((err) => console.warn("Auto mic start failed", err));
    }
  }, [isRunning, start]);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId]
  );

  const summary = useMemo(() => summarizeSessions(sessions), [sessions]);
  const streak = useMemo(() => streakDays(sessions), [sessions]);
  const weekly = useMemo(() => weeklyTotals(sessions), [sessions]);
  const exerciseTotals = useMemo(() => aggregateExerciseTotals(sessions), [sessions]);
  const period = useMemo(() => strokesByPeriod(sessions, 30), [sessions]);

  const clearStats = () => {
    const ok = window.confirm("Reset all local sessions and stroke counts? This cannot be undone.");
    if (!ok) return;
    clearLocalData();
    setSessions([]);
    setCurrentSessionId(null);
    currentSessionRef.current = null;
    setLiveCount(0);
  };

  const startSession = async () => {
    if (currentSessionRef.current) return;
    const exercise = exerciseOptions.find((e) => e.id === exerciseId);
    const session: Session = {
      id: crypto.randomUUID(),
      userId: "local",
      exerciseId: exerciseId || "default",
      exerciseName: exercise?.name ?? "General",
      startedAt: Date.now(),
      strokes: [],
      tempo: metronome.config.tempo,
      subdivision: metronome.config.subdivision
    };
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.id);
    currentSessionRef.current = session.id;
    setLiveCount(0);
    await persistSession(session);
  };

  const stopSession = async () => {
    if (!currentSessionRef.current) return;
    const end = Date.now();
    const id = currentSessionRef.current;
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, endedAt: end } : s)));
    const session = sessions.find((s) => s.id === id);
    if (session) {
      await persistSession({ ...session, endedAt: end });
    }
    currentSessionRef.current = null;
    setCurrentSessionId(null);
    setLiveCount(0);
  };

  const toggleMic = async () => {
    if (isRunning) {
      stop();
    } else {
      await start();
    }
  };

  const onAddExercise = () => {
    const name = prompt("Exercise name");
    if (!name) return;
    const ex = addExercise(name);
    setExerciseOptions((prev) => [...prev, ex]);
    setExerciseId(ex.id);
  };


  const toggleMetronome = async () => {
    if (metronome.isRunning) {
      metronome.stop();
      setMetronomeAnchorMs(null);
      return;
    }
    setMetronomeAnchorMs(performance.now());
    await metronome.start();
  };


  return (
    <div className="app">
      <div className="hero">
        <div>
          <h1>Stroke Counter</h1>
          <p className="subtitle">
            Real-time drum stroke detection, metronome, analytics, and leaderboards.
          </p>
        </div>
        <div className="controls-row">
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
          </button>
          <button onClick={toggleMic}>{isRunning ? "Stop microphone" : "Start microphone"}</button>
        </div>
      </div>

      <div className="grid">
        <div className={`panel ${currentSessionId ? "recording" : ""}`}>
          <h2>Session</h2>
          <div className="controls-row">
            <select
              className="input"
              value={exerciseId}
              onChange={(e) => setExerciseId(e.target.value)}
            >
              {exerciseOptions.map((ex) => (
                <option key={ex.id} value={ex.id}>
                  {ex.name}
                </option>
              ))}
            </select>
            <button onClick={onAddExercise}>+ Exercise</button>
          </div>
          <div className="controls-row" style={{ marginTop: 8 }}>
            <button onClick={startSession} disabled={!!currentSessionId}>
              Start session
            </button>
            <button onClick={stopSession} disabled={!currentSessionId}>
              End session
            </button>
            <span className="recording-pill" aria-live="polite">
              <span className="pulse" aria-hidden="true" />
              {currentSessionId ? "Recording" : "Idle"} · {status}
            </span>
          </div>
          <div style={{ marginTop: 12 }}>
            <div className="stat">
              <span>Live strokes</span>
              <strong>{liveCount}</strong>
            </div>
            <div className="stat">
              <span>Level (dB)</span>
              <div className="meter" style={{ flex: 1, marginLeft: 8 }}>
                <div
                  className="meter-fill"
                  style={{ width: `${Math.min(100, Math.max(0, (levelDb + 90) / 90 * 100))}%` }}
                />
              </div>
              <span style={{ width: 60, textAlign: "right" }}>{levelDb.toFixed(1)}</span>
            </div>
            <div className="stat">
              <span>Threshold (dB)</span>
              <strong>{thresholdDb.toFixed(1)}</strong>
            </div>
            <div className="controls-row">
              <label>
                Sensitivity
                <input
                  type="range"
                  min="1"
                  max="5"
                  step="0.1"
                  value={config.sensitivity}
                  onChange={(e) => updateConfig({ sensitivity: Number(e.target.value) })}
                />
                <div className="slider-value">x{config.sensitivity.toFixed(1)}</div>
              </label>
              <label>
                Debounce (ms)
                <input
                  type="range"
                  min="20"
                  max="200"
                  step="5"
                  value={config.debounceMs}
                  onChange={(e) => updateConfig({ debounceMs: Number(e.target.value) })}
                />
                <div className="slider-value">{config.debounceMs} ms</div>
              </label>
              <label>
                Window (s)
                <input
                  type="range"
                  min="5"
                  max="20"
                  step="1"
                  value={timeWindowMs / 1000}
                  onChange={(e) => setTimeWindowMs(Number(e.target.value) * 1000)}
                />
                <div className="slider-value">{(timeWindowMs / 1000).toFixed(0)} s</div>
              </label>
            </div>
          </div>
        </div>

      <div className="panel">
        <h2>Metronome</h2>
        <div className="controls-row" style={{ justifyContent: "space-between" }}>
          <button onClick={toggleMetronome}>
            {metronome.isRunning ? "Stop metronome" : "Start metronome"}
          </button>
          <span className="badge">Tempo base</span>
        </div>
        <div className="controls-row">
          <label>
            Tempo
              <input
                className="input"
                type="number"
                value={metronome.config.tempo}
                onChange={(e) => metronome.setTempo(Number(e.target.value))}
              />
            </label>
            <label>
              Subdivision
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={metronome.config.subdivision}
                onChange={(e) => metronome.setSubdivision(Number(e.target.value))}
              />
            </label>
            <label>
              Volume
              <input
                className="input"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={metronome.config.volume}
                onChange={(e) => metronome.setVolume(Number(e.target.value))}
              />
            </label>
          </div>
          <p className="subtitle">
            Sample-accurate scheduling runs alongside stroke detection with shared timebase.
          </p>
          <div className="controls-row" style={{ marginTop: 12 }}>
            <button onClick={() => setShowCalibration(true)}>AV calibration</button>
            <span className="badge">Offset: {avOffsetMs} ms</span>
          </div>
        </div>
      </div>

      <div className="panel">
        <h2>Impulse graph (last {timeWindowMs / 1000}s)</h2>
        <ImpulseGraph
          points={impulses}
          windowMs={timeWindowMs}
          height={220}
          metronomeTicks={
            metronome.isRunning && metronomeAnchorMs
              ? {
                  startMs: metronomeAnchorMs + avOffsetMs,
                  intervalMs: 60000 / (metronome.config.tempo * metronome.config.subdivision)
                }
              : undefined
          }
        />
      </div>

      <div className="grid">
        <div className="panel">
          <h3>Lifetime stats</h3>
          <div className="stat">
            <span>Total strokes</span>
            <strong>{formatNumber(summary.totalStrokes)}</strong>
          </div>
          <div className="stat">
            <span>Total practice</span>
            <strong>{formatMs(summary.totalDurationMs)}</strong>
          </div>
          <div className="stat">
            <span>Avg session length</span>
            <strong>{formatMs(summary.meanSessionDuration)}</strong>
          </div>
          <div className="stat">
            <span>Median strokes/session</span>
            <strong>{Math.round(summary.medianStrokesPerSession)}</strong>
          </div>
          <div className="stat">
            <span>Peak strokes/min</span>
            <strong>{peakSpm(sessions.flatMap((s) => s.strokes))}</strong>
          </div>
          <div className="stat">
            <span>Streak</span>
            <strong>{streak} days</strong>
          </div>
          <div className="stat">
            <span>This week</span>
            <strong>{weekly} strokes</strong>
          </div>
          <div className="controls-row" style={{ marginTop: 12 }}>
            <button className="theme-toggle" onClick={clearStats}>
              Clear lifetime stats
            </button>
          </div>
        </div>

        <div className="panel">
          <h3>Exercises</h3>
          <ul className="list">
            {exerciseTotals.map((ex) => (
              <li key={ex.exerciseId}>
                <div>
                  <strong>{ex.exerciseName}</strong>
                  <p>{formatNumber(ex.strokes)} strokes</p>
                </div>
                <span className="badge">All time</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="panel">
          <h3>Recent trend (30 days)</h3>
          <div className="charts">
            {period.map((day) => {
              const value = day.strokes;
              return (
                <div key={day.date} style={{ display: "flex", flexDirection: "column" }}>
                  <div
                    style={{
                      height: `${Math.min(120, value * 2)}px`,
                      background: "linear-gradient(120deg, var(--accent), var(--accent-2))",
                      borderRadius: 12,
                      boxShadow: "var(--shadow)"
                    }}
                  />
                  <small style={{ color: "var(--muted)" }}>
                    {new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                    {value}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Session history</h3>
        <p className="subtitle">Detailed per-session view with strokes and duration.</p>
        <div className="charts" style={{ marginBottom: 12 }}>
          {period.slice(-14).map((day) => {
            const value = day.strokes;
            return (
              <div key={day.date} style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    height: `${Math.min(120, value * 2)}px`,
                    background: "linear-gradient(120deg, var(--stroke), var(--accent))",
                    borderRadius: 12,
                    boxShadow: "var(--shadow)"
                  }}
                />
                <small style={{ color: "var(--muted)" }}>
                  {new Date(day.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })} ·{" "}
                  {value} strokes
                </small>
              </div>
            );
          })}
        </div>
        <ul className="list">
          {sessions.map((s) => (
            <li key={s.id}>
              <div>
                <strong>{s.exerciseName}</strong>
                <p>
                  {new Date(s.startedAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit"
                  })}
                  {" · "}
                  {formatMs((s.endedAt ?? Date.now()) - s.startedAt)} · {s.strokes.length} strokes
                </p>
              </div>
              <span className="badge">{s.tempo ? `${s.tempo} bpm` : "Session"}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="panel">
        <h3>Per-exercise totals (local)</h3>
        <div className="grid">
          {exerciseTotals.map((ex) => (
            <div className="panel" key={ex.exerciseId}>
              <div className="stat">
                <span>{ex.exerciseName}</span>
                <strong>{formatNumber(ex.strokes)}</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="panel">
        <h3>Debug & logging</h3>
        <div className="controls-row">
          <label>
            <input
              type="checkbox"
              checked={logging}
              onChange={(e) => setLogging(e.target.checked)}
            />{" "}
            Enable verbose logs
          </label>
          <span className="badge">{status}</span>
        </div>
        {logging && (
          <pre style={{ background: "#0b1021", padding: 12, borderRadius: 12, overflowX: "auto" }}>
            {JSON.stringify(
              {
                levelDb: levelDb.toFixed(2),
                thresholdDb: thresholdDb.toFixed(2),
                config,
                session: currentSessionId,
                strokes: currentSession?.strokes.length ?? 0
              },
              null,
              2
            )}
          </pre>
        )}
      </div>

      {showCalibration && (
        <div className="modal">
          <div className="modal-content">
            <h3>Audio/Visual Calibration</h3>
            <p className="subtitle">
              Align the metronome click with the vertical grid lines, similar to a Guitar Hero AV
              delay test.
            </p>
            <ol className="modal-steps">
              <li>Start the metronome. Watch the impulse graph lines and listen to clicks.</li>
              <li>Use the manual slider until clicks align with the grid lines visually.</li>
              <li>Use headphones if possible to avoid room latency.</li>
              <li>Close this dialog when you’re satisfied; the offset stays applied.</li>
            </ol>
            <div className="controls-row" style={{ marginTop: 8 }}>
              <label style={{ flex: 1 }}>
                Manual offset (ms)
                <input
                  type="range"
                  min={-600}
                  max={600}
                  step={1}
                  value={avOffsetMs}
                  onChange={(e) => setAvOffsetMs(Number(e.target.value))}
                  style={{ width: "100%" }}
                />
                <div className="slider-value">{avOffsetMs} ms</div>
              </label>
            </div>
            <div className="controls-row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button className="theme-toggle" onClick={() => setShowCalibration(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
