export type StrokeEvent = {
  id: string;
  at: number; // epoch ms
  db: number;
  rms: number;
  thresholdDb: number;
  floorDb: number;
  exerciseId?: string;
};

export type Session = {
  id: string;
  userId: string;
  exerciseId: string;
  exerciseName: string;
  startedAt: number;
  endedAt?: number;
  strokes: StrokeEvent[];
  tempo?: number;
  subdivision?: number;
  createdAt?: string;
};

export type Exercise = {
  id: string;
  name: string;
  goalPerDay?: number;
};

export type LeaderboardEntry = {
  id: string;
  userName: string;
  value: number;
  label: string;
};

export type UserProfile = {
  id: string;
  displayName: string;
  email?: string;
  photoUrl?: string;
  createdAt?: string;
};

export type MetricSummary = {
  totalStrokes: number;
  totalDurationMs: number;
  sessionCount: number;
  meanSessionDuration: number;
  medianSessionDuration: number;
  meanStrokesPerSession: number;
  medianStrokesPerSession: number;
};
