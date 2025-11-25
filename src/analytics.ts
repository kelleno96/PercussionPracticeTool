import { differenceInDays, endOfDay, startOfDay, startOfWeek } from "date-fns";
import type { Session, StrokeEvent, UserProfile } from "./types";

const median = (arr: number[]) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
};

export function summarizeSessions(sessions: Session[]) {
  const durations = sessions.map((s) => (s.endedAt ?? Date.now()) - s.startedAt);
  const strokeCounts = sessions.map((s) => s.strokeCount ?? s.strokes.length);
  const totalDurationMs = durations.reduce((a, b) => a + b, 0);
  const totalStrokes = strokeCounts.reduce((a, b) => a + b, 0);
  return {
    totalStrokes,
    totalDurationMs,
    sessionCount: sessions.length,
    meanSessionDuration: durations.length ? totalDurationMs / durations.length : 0,
    medianSessionDuration: median(durations),
    meanStrokesPerSession: strokeCounts.length ? totalStrokes / strokeCounts.length : 0,
    medianStrokesPerSession: median(strokeCounts)
  };
}

export function strokesByPeriod(sessions: Session[], daysBack = 30) {
  const now = Date.now();
  const buckets: { date: string; strokes: number }[] = [];
  for (let i = daysBack; i >= 0; i--) {
    const day = startOfDay(now - i * 86_400_000);
    const end = endOfDay(day);
    const strokes = sessions
      .flatMap((s) => s.strokes)
      .filter((st) => st.at >= day && st.at <= end).length;
    buckets.push({ date: new Date(day).toISOString(), strokes });
  }
  return buckets;
}

export function streakDays(sessions: Session[]) {
  if (!sessions.length) return 0;
  const uniqueDays = new Set(
    sessions.map((s) => startOfDay(s.startedAt)).map((d) => new Date(d).toDateString())
  );
  const days = [...uniqueDays].map((d) => new Date(d).getTime()).sort((a, b) => b - a);
  let streak = 1;
  for (let i = 1; i < days.length; i++) {
    const diff = differenceInDays(days[i - 1], days[i]);
    if (diff === 1) streak++;
    else break;
  }
  return streak;
}

export function aggregateExerciseTotals(sessions: Session[]) {
  const map = new Map<string, { exerciseName: string; strokes: number }>();
  sessions.forEach((s) => {
    const current = map.get(s.exerciseId) ?? { exerciseName: s.exerciseName, strokes: 0 };
    current.strokes += s.strokeCount ?? s.strokes.length;
    map.set(s.exerciseId, current);
  });
  return [...map.entries()].map(([exerciseId, entry]) => ({
    exerciseId,
    ...entry
  }));
}

export function peakSpm(strokes: StrokeEvent[], windowMs = 60_000) {
  if (!strokes.length) return 0;
  let max = 0;
  for (let i = 0; i < strokes.length; i++) {
    const start = strokes[i].at;
    const end = start + windowMs;
    let count = 0;
    for (let j = i; j < strokes.length && strokes[j].at <= end; j++) count++;
    max = Math.max(max, (count * 60_000) / windowMs);
  }
  return Math.round(max);
}

const shortHash = (input: string) => {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36).slice(0, 6);
};

const labelForUser = (profile?: Pick<UserProfile, "id" | "firstName" | "displayName" | "safeName">) => {
  if (profile?.safeName) return profile.safeName;
  const base = profile?.firstName || profile?.displayName || "You";
  const tagSource = profile?.id || base;
  return `${base}_${shortHash(tagSource)}`;
};

export function weeklyTotals(sessions: Session[]) {
  const start = startOfWeek(new Date(), { weekStartsOn: 1 }).getTime();
  return sessions
    .flatMap((s) => s.strokes)
    .filter((st) => st.at >= start)
    .length;
}
