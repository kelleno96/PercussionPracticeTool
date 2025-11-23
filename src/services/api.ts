import type { LeaderboardEntry, Session, StrokeEvent, UserProfile } from "../types";
import { hasRemoteBackend, supabase } from "./supabaseClient";
import { appendStroke, loadExercises, loadProfile, loadSessions, saveExercises, saveProfile, saveSessions } from "./localStore";

export type AuthProvider = "google";

const shortHash = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
};

const firstNameFrom = (name?: string | null) => {
  if (!name) return "Drummer";
  const trimmed = name.trim();
  if (!trimmed) return "Drummer";
  return trimmed.split(/\s+/)[0];
};

const uniqueName = (firstName: string, id?: string) => `${firstName}_${shortHash(id ?? firstName)}`;

const isUuid = (value: string | null | undefined) =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

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
      const firstName = firstNameFrom(displayName);
      const profile: UserProfile = {
        id: data.user.id,
        displayName,
        firstName,
        email: data.user.email ?? undefined,
        safeName: uniqueName(firstName, data.user.id)
      };
      try {
        const payload = {
          id: profile.id,
          display_name: profile.displayName,
          safe_display_name: profile.safeName
        };
        const { error } = await supabase.from("profiles").upsert(payload);
        if (error && error.code === "PGRST204") {
          // fallback if column not yet created
          await supabase.from("profiles").upsert({
            id: profile.id,
            display_name: profile.displayName
          });
        } else if (error) {
          throw error;
        }
      } catch (err) {
        console.warn("Profile upsert failed", err);
      }
      return profile;
    }
  }
  const local = loadProfile();
  return local
    ? {
        id: "local",
        displayName: local.displayName,
        firstName: local.firstName,
        safeName: uniqueName(local.firstName ?? local.displayName ?? "Guest", local.displayName)
      }
    : { id: "anon", displayName: "Guest drummer", firstName: "Guest", safeName: uniqueName("Guest", "anon") };
}

export async function persistSession(session: Session) {
  const canRemote =
    hasRemoteBackend && supabase && session.userId && session.userId !== "anon" && session.userId !== "local";
  if (canRemote) {
    const { error } = await supabase.from("sessions").upsert({
      id: session.id,
      user_id: session.userId,
      exercise_id: isUuid(session.exerciseId) ? session.exerciseId : null,
      exercise_name: session.exerciseName,
      started_at: new Date(session.startedAt).toISOString(),
      ended_at: session.endedAt ? new Date(session.endedAt).toISOString() : null,
      tempo: session.tempo ?? null,
      subdivision: session.subdivision ?? null
    });
    if (error) {
      console.warn("Failed to persist session remotely, saving locally", error.message);
      const sessions = loadSessions();
      const idx = sessions.findIndex((s) => s.id === session.id);
      if (idx >= 0) sessions[idx] = session;
      else sessions.push(session);
      saveSessions(sessions);
    }
  } else {
    const sessions = loadSessions();
    const idx = sessions.findIndex((s) => s.id === session.id);
    if (idx >= 0) sessions[idx] = session;
    else sessions.push(session);
    saveSessions(sessions);
  }
}

export async function appendStrokeEvent(sessionId: string, stroke: StrokeEvent, userId?: string) {
  const canRemote =
    hasRemoteBackend && supabase && userId && userId !== "anon" && userId !== "local";
  if (canRemote) {
    const { error } = await supabase.from("strokes").insert({
      id: stroke.id,
      session_id: sessionId,
      user_id: userId ?? null,
      at: new Date(stroke.at).toISOString(),
      db: stroke.db,
      rms: stroke.rms,
      threshold_db: stroke.thresholdDb,
      floor_db: stroke.floorDb,
      exercise_id: isUuid(stroke.exerciseId) ? stroke.exerciseId : null
    });
    if (error) {
      console.warn("Failed to insert stroke", error.message);
    }
  } else {
    appendStroke(sessionId, stroke);
  }
}

export async function listSessions(): Promise<Session[]> {
  if (hasRemoteBackend && supabase) {
    const { data, error, status } = await supabase
      .from("sessions_view")
      .select("*")
      .order("started_at", { ascending: false });
    if (!error) {
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
    if (status === 401 || status === 403) {
      console.warn("Not authenticated when fetching sessions, falling back to local");
    } else {
      console.warn("Failed to fetch sessions, falling back to local", error?.message);
    }
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
      return payload.map((row, idx) => {
        const firstName = firstNameFrom(row.display_name ?? row.name ?? row.user ?? "Drummer");
        const safe = uniqueName(firstName, row.user_id ?? row.id ?? firstName);
        return {
          id: `${data?.[0]?.id ?? "lb"}-${idx}`,
          userName: safe,
          value: row.value ?? row.total ?? 0,
          label: category
        };
      });
    } catch (err) {
      console.warn("Failed to fetch public leaderboards", err);
    }
  }
  return [];
}
