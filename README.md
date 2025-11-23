# Stroke Counter (browser-based)

Real-time percussion practice web app for mobile and desktop: microphone stroke detection, sample-accurate metronome, exercise tracking, analytics, and leaderboards. Built with Vite + React + TypeScript and Supabase (optional) for auth, storage, and leaderboards. Works offline with localStorage fallback.

## Stack & rationale
- React + Vite: fast dev/build, good mobile performance.
- Web Audio API: AudioWorklet stroke detection (ScriptProcessor fallback) and metronome with ahead-of-time scheduling.
- Supabase: Google/Apple OAuth, Postgres, RLS, serverless functions if needed; localStorage fallback keeps the app usable without auth.
- Lightweight d3 helpers for simple charting, date-fns for time math.

## Project layout
```
.
├─ src/
│  ├─ App.tsx                # UI + orchestration
│  ├─ components/ImpulseGraph.tsx
│  ├─ hooks/useStrokeDetector.ts
│  ├─ hooks/useMetronome.ts
│  ├─ services/              # supabase + local storage
│  ├─ analytics.ts           # metrics helpers
│  ├─ styles.css
│  └─ types.ts
├─ public/
│  ├─ worklets/stroke-processor.js  # AudioWorklet transient detector
│  ├─ favicon.svg
│  └─ manifest.webmanifest
├─ docs/
│  ├─ architecture.md
│  └─ schema.sql
├─ index.html
├─ package.json
└─ vite.config.ts
```

## Getting started
Prereqs: Node 18+ and pnpm/npm/yarn.
```bash
npm install
npm run dev
# open http://localhost:5173
```

Environment variables (create `.env.local`):
```
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```
Without these, the app runs fully client-side with local persistence.

## Deployment
1. Supabase: create project, run `docs/schema.sql` in SQL editor, enable Google + Apple providers, set redirect URLs to your domain, and enable RLS.
2. Vercel/Netlify: set env vars above, run `npm run build`, deploy `dist/`.
3. Add `https` only, set CSP to restrict microphone access to your origin, and serve over TLS (required for mic).

## Stroke detection algorithm
- AudioWorklet mixes mic channels to mono, computes RMS per frame, tracks an exponential moving average (noise floor), and triggers when `rms > floor * sensitivity` and `dB` exceeds `floorDb + sensitivity*6dB` with debounce.
- Configurable params: `sensitivity`, `debounceMs`, `minDb`, `alpha` (floor smoothing).
- Fallback ScriptProcessor mirrors the same logic if AudioWorklets are unavailable (older iOS).
- UI shows live dB level and threshold; graph window uses fixed time width to avoid X-axis stretching.

## Data model (Supabase)
- `profiles`: user metadata (display name, safe username).
- `exercises`: per-user or global exercises.
- `sessions`: practice sessions with tempo/subdivision metadata.
- `strokes`: individual stroke events (time, dB, rms, thresholds).
- `leaderboard_cache`: materialized/paginated leaderboards (lifetime, weekly, streaks, per-exercise).
See `docs/schema.sql` for full DDL + indexes and RLS hints.

## Key features
- Mobile-first UI with large controls, dark/light themes.
- Sample-accurate metronome running concurrently with stroke detection.
- Real-time impulse graph (60 fps) with stroke markers and fixed time window.
- Exercise-specific tracking, lifetime analytics, weekly trends, streaks, peak SPM.
- Leaderboard scaffolding with public-safe display names.
- Toggleable debug panel for audio telemetry.

## Future improvements
1) Add offline-to-online sync queues for strokes/sessions.  
2) Ship a dedicated Service Worker + background sync for PWA install.  
3) Implement Supabase Edge Functions for anti-cheat (rate limits, signed stroke batches).  
4) Add calibration wizard for per-device gain and dynamic threshold tuning.  
5) Expand visualization (per-stroke velocity histograms, subdivision accuracy heatmaps).  
6) Add account deletion flow calling Supabase function to purge user data.
