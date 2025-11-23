import type { Session, StrokeEvent, UserProfile } from "../types";
import { hasRemoteBackend, supabase } from "./supabaseClient";
import { appendStroke, loadExercises, loadProfile, loadSessions, saveExercises, saveProfile, saveSessions } from "./localStore";

export type AuthProvider = "google";

export async function signIn(provider: AuthProvider) {
  if (hasRemoteBackend && supabase) {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href }
    });
    if (error) throw error;
    return data;
  }
  // Local fallback just fakes a profile
  const profile = { displayName: "Offline drummer" };
  saveProfile(profile);
  return profile;
}

export async function signOut() {
  if (hasRemoteBackend && supabase) {
    await supabase.auth.signOut();
  }
  saveProfile({ displayName: "Offline drummer" });
}

export async function getProfile(): Promise<UserProfile | null> {
  if (hasRemoteBackend && supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      return {
        id: data.user.id,
        displayName: data.user.user_metadata.full_name ?? data.user.email ?? "Drummer",
        email: data.user.email ?? undefined
      };
    }
  }
  const local = loadProfile();
  return local
    ? { id: "local", displayName: local.displayName }
    : { id: "anon", displayName: "Guest drummer" };
}

export async function persistSession(session: Session) {
  if (hasRemoteBackend && supabase) {
    await supabase.from("sessions").upsert({
      id: session.id,
      user_id: session.userId,
      exercise_id: session.exerciseId,
      exercise_name: session.exerciseName,
      started_at: new Date(session.startedAt).toISOString(),
      ended_at: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      tempo: session.tempo ?? null,
      subdivision: session.subdivision ?? null,
      strokes: session.strokes
    });
  } else {
    const sessions = loadSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) sessions[idx] = session;
    else sessions.push(session);
    saveSessions(sessions);
  }
}

export async function appendStrokeEvent(sessionId: string, stroke: StrokeEvent) {
  if (hasRemoteBackend && supabase) {
    await supabase.from("strokes").insert({
      id: stroke.id,
      session_id: sessionId,
      at: new Date(stroke.at).toISOString(),
      db: stroke.db,
      rms: stroke.rms,
      threshold_db: stroke.thresholdDb,
      floor_db: stroke.floorDb,
      exercise_id: stroke.exerciseId ?? null
    });
  } else {
    appendStroke(sessionId, stroke);
  }
}

export async function listSessions(): Promise<Session[]> {
  if (hasRemoteBackend && supabase) {
    const { data, error } = await supabase
      .from("sessions_view")
      .select("*")
      .order("started_at", { ascending: false });
    if (error) throw error;
    return (
      data?.map((row) => ({
        id: row.id,
        userId: row.user_id,
        exerciseId: row.exercise_id,
        exerciseName: row.exercise_name,
        startedAt: new Date(row.started_at).getTime(),
        endedAt: row.ended_at ? new Date(row.ended_at).getTime() : undefined,
        tempo: row.tempo ?? undefined,
        subdivision: row.subdivision ?? undefined,
        strokes: (row.strokes ?? []) as StrokeEvent[]
      })) ?? []
    );
  }
  return loadSessions();
}

export function listExercises() {
  return loadExercises();
}

export function addExercise(name: string) {
  const exercises = loadExercises();
  const newExercise = { id: crypto.randomUUID(), name };
  exercises.push(newExercise);
  saveExercises(exercises);
  return newExercise;
}
