# Stroke Counter (browser-based)

Real-time percussion practice web app for mobile and desktop: microphone stroke detection, sample-accurate metronome, exercise tracking, and analytics. Built with Vite + React + TypeScript. Works offline with localStorage persistence.

## Stack & rationale
- React + Vite: fast dev/build, good mobile performance.
- Web Audio API: AudioWorklet stroke detection (ScriptProcessor fallback) and metronome with ahead-of-time scheduling.
- Canvas: custom impulse/timing visualizations.
- Supabase scaffolding (currently disabled in code) for optional auth + storage.
- date-fns for time math.

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
Remote backend is currently disabled in `src/services/supabaseClient.ts`. Without changes there, the app runs fully client-side with local persistence.

## Deployment
1. Vercel/Netlify: run `npm run build`, deploy `dist/`.
2. Add `https` only, set CSP to restrict microphone access to your origin, and serve over TLS (required for mic).
3. Optional: re-enable Supabase in `src/services/supabaseClient.ts`, set env vars above, and apply `docs/schema.sql`.

## Stroke detection algorithm
- AudioWorklet uses a single input channel, computes RMS per frame, tracks an exponential moving average (noise floor), and triggers when `rms > floor * sensitivity` and `dB` exceeds `floorDb + sensitivity*6dB` with debounce.
- Configurable params: `sensitivity`, `debounceMs`, `minDb`, `alpha` (floor smoothing), `measureWindowMs` (post-hit loudness window).
- Fallback ScriptProcessor mirrors the same logic if AudioWorklets are unavailable (older iOS).
- UI shows live dB level and threshold; graph window uses fixed time width to avoid X-axis stretching.

## Data model (optional Supabase, currently disabled)
See `docs/schema.sql` for the tables and RLS hints used by the optional backend.

## Key features
- Mobile-first UI with large controls, dark/light themes.
- Sample-accurate metronome running concurrently with stroke detection.
- Real-time impulse graph and timing consistency graph with fixed time window.
- Exercise-specific session tracking, lifetime analytics, weekly trends, streaks, peak SPM.
- AV calibration slider and audio telemetry debug panel.

## Future improvements
1) Add offline-to-online sync queues for strokes/sessions.  
2) Ship a dedicated Service Worker + background sync for PWA install.  
3) Implement Supabase Edge Functions for anti-cheat (rate limits, signed stroke batches).  
4) Add calibration wizard for per-device gain and dynamic threshold tuning.  
5) Expand visualization (per-stroke velocity histograms, subdivision accuracy heatmaps).  
6) Add account deletion flow calling Supabase function to purge user data.
