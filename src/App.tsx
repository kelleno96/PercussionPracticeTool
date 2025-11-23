import React, { useEffect, useMemo, useState, useCallback } from "react";
import { ImpulseGraph, type ImpulsePoint } from "./components/ImpulseGraph";
import { useStrokeDetector } from "./hooks/useStrokeDetector";
import { useMetronome } from "./hooks/useMetronome";
import {
  addExercise,
  appendStrokeEvent,
  getProfile,
  listExercises,
  listSessions,
  persistSession
} from "./services/api";
import { signIn, signOut } from "./services/api";
import {
  aggregateExerciseTotals,
  leaderboardsFromSessions,
  peakSpm,
  strokesByPeriod,
  streakDays,
  summarizeSessions,
  weeklyTotals
} from "./analytics";
import type { Session, StrokeEvent, UserProfile } from "./types";

const formatMs = (ms: number) => {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

const formatNumber = (n: number) => n.toLocaleString();

function App() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [exerciseOptions, setExerciseOptions] = useState<{ id: string; name: string }[]>([]);
  const [exerciseId, setExerciseId] = useState<string>("");
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [impulses, setImpulses] = useState<ImpulsePoint[]>([]);
  const [timeWindowMs, setTimeWindowMs] = useState(8000);
  const [logging, setLogging] = useState(false);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [thresholdDb, setThresholdDb] = useState(-40);
  const [liveCount, setLiveCount] = useState(0);
  const [authing, setAuthing] = useState(false);

  const { isRunning, status, levelDb, config, start, stop, updateConfig } = useStrokeDetector(
    useCallback(
      (stroke: StrokeEvent) => {
        setThresholdDb(stroke.thresholdDb);
        setImpulses((prev) => {
          const now = performance.now();
          const next = [
            ...prev,
            { t: now, amplitude: stroke.db, isHit: true, thresholdDb: stroke.thresholdDb }
          ].filter((p) => p.t >= now - timeWindowMs);
          return next;
        });
        if (currentSessionId) {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === currentSessionId ? { ...s, strokes: [...s.strokes, stroke] } : s
            )
          );
          appendStrokeEvent(currentSessionId, { ...stroke, exerciseId });
        }
        setLiveCount((c) => c + 1);
      },
      [currentSessionId, exerciseId, timeWindowMs]
    ),
    useCallback(
      (telemetry) => {
        setThresholdDb(telemetry.thresholdDb);
        setImpulses((prev) => {
          const now = performance.now();
          const next = [
            ...prev,
            { t: now, amplitude: telemetry.db, thresholdDb: telemetry.thresholdDb }
          ].filter((p) => p.t >= now - timeWindowMs);
          return next;
        });
      },
      [timeWindowMs]
    )
  );

  const metronome = useMetronome({ tempo: 90, subdivision: 1, volume: 0.6 });

  useEffect(() => {
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    (async () => {
      const loadedProfile = await getProfile();
      setProfile(loadedProfile);
      const loadedSessions = await listSessions();
      setSessions(loadedSessions);
      const exercises = listExercises();
      setExerciseOptions(exercises);
      setExerciseId(exercises[0]?.id ?? "");
    })();
  }, []);

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId) ?? null,
    [sessions, currentSessionId]
  );

  const summary = useMemo(() => summarizeSessions(sessions), [sessions]);
  const streak = useMemo(() => streakDays(sessions), [sessions]);
  const weekly = useMemo(() => weeklyTotals(sessions), [sessions]);
  const exerciseTotals = useMemo(() => aggregateExerciseTotals(sessions), [sessions]);
  const period = useMemo(() => strokesByPeriod(sessions, 14), [sessions]);

  const startSession = async () => {
    if (currentSessionId) return;
    const exercise = exerciseOptions.find((e) => e.id === exerciseId);
    const session: Session = {
      id: crypto.randomUUID(),
      userId: profile?.id ?? "anon",
      exerciseId: exerciseId || "default",
      exerciseName: exercise?.name ?? "General",
      startedAt: Date.now(),
      strokes: [],
      tempo: metronome.config.tempo,
      subdivision: metronome.config.subdivision
    };
    setSessions((prev) => [session, ...prev]);
    setCurrentSessionId(session.id);
    await persistSession(session);
  };

  const stopSession = async () => {
    if (!currentSessionId) return;
    const end = Date.now();
    setSessions((prev) =>
      prev.map((s) => (s.id === currentSessionId ? { ...s, endedAt: end } : s))
    );
    const session = sessions.find((s) => s.id === currentSessionId);
    if (session) {
      await persistSession({ ...session, endedAt: end });
    }
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

  const leaderboards = useMemo(
    () => leaderboardsFromSessions(sessions, profile?.displayName ?? "You"),
    [sessions, profile]
  );

  const handleAuth = async (provider: "google" | "apple") => {
    setAuthing(true);
    try {
      await signIn(provider);
      const refreshed = await getProfile();
      setProfile(refreshed);
    } finally {
      setAuthing(false);
    }
  };

  const handleSignOut = async () => {
    setAuthing(true);
    try {
      await signOut();
      const refreshed = await getProfile();
      setProfile(refreshed);
    } finally {
      setAuthing(false);
    }
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
          <span className="badge">{profile?.displayName ?? "Guest"}</span>
          <button
            className="theme-toggle"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
          >
            {theme === "dark" ? "🌙 Dark" : "☀️ Light"}
          </button>
          <button onClick={() => handleAuth("google")} disabled={authing}>
            Google
          </button>
          <button onClick={() => handleAuth("apple")} disabled={authing}>
            Apple
          </button>
          <button onClick={handleSignOut} disabled={authing}>
            Sign out
          </button>
          <button onClick={toggleMic}>{isRunning ? "Stop microphone" : "Start microphone"}</button>
          <button onClick={() => (metronome.isRunning ? metronome.stop() : metronome.start())}>
            {metronome.isRunning ? "Stop metronome" : "Start metronome"}
          </button>
        </div>
      </div>

      <div className="grid">
        <div className="panel">
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
            <span className="badge">
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
                  min="1.4"
                  max="4"
                  step="0.1"
                  value={config.sensitivity}
                  onChange={(e) => updateConfig({ sensitivity: Number(e.target.value) })}
                />
              </label>
              <label>
                Debounce (ms)
                <input
                  type="range"
                  min="40"
                  max="140"
                  step="5"
                  value={config.debounceMs}
                  onChange={(e) => updateConfig({ debounceMs: Number(e.target.value) })}
                />
              </label>
              <label>
                Window (s)
                <input
                  type="range"
                  min="5"
                  max="12"
                  step="1"
                  value={timeWindowMs / 1000}
                  onChange={(e) => setTimeWindowMs(Number(e.target.value) * 1000)}
                />
              </label>
            </div>
          </div>
        </div>

        <div className="panel">
          <h2>Metronome</h2>
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
        </div>
      </div>

      <div className="panel">
        <h2>Impulse graph (last {timeWindowMs / 1000}s)</h2>
        <ImpulseGraph points={impulses} windowMs={timeWindowMs} height={220} />
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
          <h3>Recent trend</h3>
          <div className="charts">
            {period.map((day) => {
              const value = day.strokes;
              return (
                <div key={day.date} style={{ display: "flex", flexDirection: "column" }}>
                  <div
                    style={{
                      height: `${Math.min(100, value * 2)}px`,
                      background: "linear-gradient(120deg, var(--accent), var(--accent-2))",
                      borderRadius: 12,
                      boxShadow: "var(--shadow)"
                    }}
                  />
                  <small style={{ color: "var(--muted)" }}>
                    {new Date(day.date).toLocaleDateString(undefined, { weekday: "short" })} ·{" "}
                    {value}
                  </small>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="panel">
        <h3>Leaderboards</h3>
        <p className="subtitle">Public-safe display names, paginated for scale.</p>
        <div className="grid">
          {leaderboards.map((entry) => (
            <div className="panel" key={entry.id}>
              <h4>{entry.label}</h4>
              <div className="stat">
                <span>{entry.userName}</span>
                <strong>{formatNumber(entry.value)}</strong>
              </div>
            </div>
          ))}
        </div>
        <h4>Per-exercise leaders</h4>
        <div className="grid">
          {exerciseTotals.map((ex) => (
            <div className="panel" key={ex.exerciseId}>
              <div className="stat">
                <span>{ex.exerciseName}</span>
                <strong>{formatNumber(ex.strokes)}</strong>
              </div>
              <p className="subtitle">Example local leaderboard entry.</p>
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
    </div>
  );
}

export default App;
