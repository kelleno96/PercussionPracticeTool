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
    { id: "single", name: "Single strokes" },
    { id: "para", name: "Paradiddle" },
    { id: "flam", name: "Flam taps" }
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
