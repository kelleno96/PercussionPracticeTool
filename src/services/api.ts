import type { LeaderboardEntry, Session, StrokeEvent, UserProfile } from "../types";
import { hasRemoteBackend, supabase } from "./supabaseClient";
import { appendStroke, loadExercises, loadProfile, loadSessions, saveExercises, saveProfile, saveSessions } from "./localStore";

export type AuthProvider = "google";

const firstNameFrom = (name?: string | null) => {
  if (!name) return "Drummer";
  const trimmed = name.trim();
  if (!trimmed) return "Drummer";
  return trimmed.split(/\s+/)[0];
};

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
  const profile = { displayName: "Offline drummer", firstName: "Offline" };
  saveProfile(profile);
  return profile;
}

export async function signOut() {
  if (hasRemoteBackend && supabase) {
    await supabase.auth.signOut();
  }
  saveProfile({ displayName: "Offline drummer", firstName: "Offline" });
}

export async function getProfile(): Promise<UserProfile | null> {
  if (hasRemoteBackend && supabase) {
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      const displayName = data.user.user_metadata.full_name ?? data.user.email ?? "Drummer";
      const profile: UserProfile = {
        id: data.user.id,
        displayName,
        firstName: firstNameFrom(displayName),
        email: data.user.email ?? undefined
      };
      try {
        await supabase.from("profiles").upsert({
          id: profile.id,
          display_name: profile.displayName
        });
      } catch (err) {
        console.warn("Profile upsert failed", err);
      }
      return profile;
    }
  }
  const local = loadProfile();
  return local
    ? { id: "local", displayName: local.displayName, firstName: local.firstName }
    : { id: "anon", displayName: "Guest drummer", firstName: "Guest" };
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

export async function fetchPublicLeaderboards(): Promise<LeaderboardEntry[]> {
  if (hasRemoteBackend && supabase) {
    try {
      const { data, error } = await supabase
        .from("leaderboard_cache")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      const payload = (data?.[0]?.payload as any[]) || [];
      const category = data?.[0]?.category ?? "Leaderboard";
      return payload.map((row, idx) => ({
        id: `${data?.[0]?.id ?? "lb"}-${idx}`,
        userName: firstNameFrom(row.display_name ?? row.name ?? row.user ?? "Drummer"),
        value: row.value ?? row.total ?? 0,
        label: category
      }));
    } catch (err) {
      console.warn("Failed to fetch public leaderboards", err);
    }
  }
  return [];
}
