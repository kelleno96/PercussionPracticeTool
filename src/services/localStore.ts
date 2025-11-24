import type { Session, StrokeEvent } from "../types";

const SESSIONS_KEY = "stroke-counter/sessions";
const EXERCISES_KEY = "stroke-counter/exercises";
const PROFILE_KEY = "stroke-counter/profile";

const read = <T>(key: string, fallback: T): T => {
  if (typeof localStorage === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(key, JSON.stringify(value));
};

export function loadSessions(): Session[] {
  return read<Session[]>(SESSIONS_KEY, []);
}

export function saveSessions(sessions: Session[]) {
  write(SESSIONS_KEY, sessions);
}

export function clearSessions() {
  write(SESSIONS_KEY, []);
}

export function loadExercises() {
  return read<{ id: string; name: string }[]>(EXERCISES_KEY, [
    { id: "eights", name: "Eights" },
    { id: "accent-taps", name: "Accent Taps" },
    { id: "short-short-long", name: "Short-Short-Long" },
    { id: "triplet-rolls", name: "Triplet Rolls" },
    { id: "twos", name: "Twos (Double Beat)" },
    { id: "threes", name: "Threes (Triple Beat)" },
    { id: "16th-accent-grid", name: "16th Note Accent Grid" },
    { id: "triplet-accent-grid", name: "Triplet Accent Grid" },
    { id: "16th-diddle-grid", name: "16th Note Diddle Grid" },
    { id: "triplet-diddle-grid", name: "Triplet Diddle Grid" },
    { id: "mini-poofs", name: "MiniPoofs" },
    { id: "flamkuchen", name: "Flamkuchen" },
    { id: "stick-control-1", name: "Stick Control #1" },
    { id: "stick-control-2", name: "Stick Control #2" },
    { id: "stick-control-16th", name: "Stick Control (16th Notes)" }
  ]);
}

export function saveExercises(exercises: { id: string; name: string }[]) {
  write(EXERCISES_KEY, exercises);
}

export function saveProfile(profile: { displayName: string; firstName?: string }) {
  write(PROFILE_KEY, profile);
}

export function loadProfile() {
  return read<{ displayName: string; firstName?: string } | null>(PROFILE_KEY, null);
}

export function appendStroke(sessionId: string, stroke: StrokeEvent) {
  const sessions = loadSessions();
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return sessions;
  session.strokes.push(stroke);
  saveSessions(sessions);
  return sessions;
}
