# Architecture & implementation notes

## Frontend
- Framework: Vite + React + TypeScript (mobile-first, minimal deps).
- Audio:
  - AudioWorklet (`public/worklets/stroke-processor.js`) performs RMS + EMA floor + thresholding + debounce.
  - ScriptProcessor fallback mirrors logic for older browsers.
  - Metronome uses Web Audio scheduling with short lookahead window; separate `AudioContext` to avoid coupling with mic graph.
  - Impulse graph renders with canvas at 60 fps, fixed-width time window to prevent X-axis stretching.
- State:
  - `useStrokeDetector` owns mic lifecycle and config.
  - `useMetronome` owns tempo/subdivision/volume and scheduling.
  - `analytics.ts` derives summaries, trends, streaks, peak SPM, per-exercise totals, leaderboards.
- UI:
  - Large tap targets, dark/light themes via CSS variables.
  - Debug/log panel gated by toggle.
  - Mobile-friendly grid layout; canvas adapts to DPR.

## Backend (Supabase-first, local fallback)
- Supabase:
  - OAuth providers: Google, Apple.
  - Tables: `profiles`, `exercises`, `sessions`, `strokes`, `leaderboard_cache`.
  - Use RLS to scope data to `auth.uid()`, except public leaderboards which expose safe display names only.
  - Leaderboard caching: weekly cron or edge function aggregates strokes and stores paginated slices.
  - Edge Function (not included) suggested for anti-abuse and signed stroke batches.
- Local fallback:
  - localStorage mirrors sessions/exercises/profile when Supabase keys are absent.
  - Keeps UI functional offline; sync strategy outlined in README future work.

## Security, privacy, and safety
- Serve over HTTPS (mic requirement) with strict CSP and permission prompts contextualized in UI copy.
- RLS: all writes scoped to user, leaderboards expose only sanitized display names.
- Rate limits: apply at Edge Function/API gateway for stroke batching + leaderboard fetches.
- Audit trail: store stroke batch source IP/user-agent and anomaly scores in `leaderboard_cache` or a dedicated `audit_logs` table.
- Account deletion: implement Supabase function to cascade delete strokes/sessions/exercises/profile.

## Performance and battery
- AudioWorklet keeps processing off main thread; fallback is lighter-weight.
- Fixed-size buffers and clipped canvas drawing prevent allocations per frame.
- Metronome uses a short lookahead (100 ms) to stay sample-accurate without heavy timers.
- RequestAnimationFrame rendering; no interval polling.
- Avoids heavy UI libs; CSS-only theming.

## Extensibility
- Metrics: `analytics.ts` centralizes aggregations for easy additions.
- Visualization: swap canvas for WebGL/Three.js if higher-density plots are needed.
- Data: supabase client isolated in `services/`; can swap for other backends (Firebase, custom API) with minimal UI changes.
- Logging: debug panel ready for remote logging hook (e.g., Sentry/console-replay) gated by toggle.
