# Plan: Twitch TTS Widget & Streamer Dashboard (Fish Audio + OBS)

- **Workstream:** lalo
- **Principal:** jagc
- **Lead:** tech_lead & streaming_engineer
- **Coordinator:** captain
- **Stack:** Vite + React 19 + TypeScript + Tailwind CSS + GSAP + tmi.js + Node.js (Express server / API proxy)

## Phase 1: Environment & Project Scaffolding
- [x] 1.1: Framework setup (TheAgency multi-agent system).
- [x] 1.2: Register agent roles (`captain`, `tech_lead`, `reviewer_code`, `reviewer_security`, `streaming_engineer`).
- [x] 1.3: Initialize Vite + React + TypeScript + Tailwind CSS + Lucide Icons + GSAP project structure.
- [x] 1.4: Configure Node.js backend server with Express, CORS, and Fish Audio API proxy.

## Phase 2: Core Real-Time & Audio Engine
- [x] 2.1: `src/utils/twitchSanitizer.ts`: Strict `!s ` trigger filtering, URL removal, length limiting (<=200 chars), spam reduction, Unicode surrogate pair safe.
- [x] 2.2: `src/hooks/useTwitchChat.ts`: Anonymous connection with `tmi.js`, FIFO message queue, strict cleanup on unmount for OBS.
- [x] 2.3: Audio playback lifecycle: HTML5 Audio coordinator with state transitions, `onEnded`/`onError` event handling, lock release, and 25s safety watchdog.

## Phase 3: OBS Widget with GSAP Animation ("Impeccable" UI)
- [x] 3.1: Transparent OBS layout (`bg-transparent`, no scrollbars, high-DPI scaling).
- [x] 3.2: GSAP Entrance/Exit Timeline (`y: 50, opacity: 0, back.out(1.7)` entrance; `opacity: 0, y: -20` exit).
- [x] 3.3: Dynamic Audio Equalizer (staggered vibrating waveform bars animating while TTS audio is playing, pausing cleanly upon completion).

## Phase 4: Streamer Control Dashboard
- [x] 4.1: Dark Mode Glassmorphism UI with subtle 1px border cards and deep drop shadows.
- [x] 4.2: Streamer controls: Twitch channel name, voice selector (reference_id), volume, speed sliders.
- [x] 4.3: Interactive testing suite: Simulated chat input, manual TTS trigger, real-time connection status pill.

## Phase 5: Backend Fish Audio API Integration & Serverless Proxy
- [x] 5.1: POST `/api/tts` endpoint: Forward sanitized payload to Fish Audio V1 API (`https://api.fish.audio/v1/tts`).
- [x] 5.2: Stream/Buffer handling: Forward ArrayBuffer / `audio/mpeg` stream to client.
- [x] 5.3: Resilient fallback / mock synthesis when API key is not present in `.env` (PCM/WAV generator for offline testing).

## Phase 6: Quality Gates & Verification
- [x] 6.1: Unit testing of `twitchSanitizer` with Vitest (8/8 passed).
- [x] 6.2: `reviewer_code` code quality gate (race condition fix, GSAP unmount cleanup, blob URL revocation).
- [x] 6.3: `reviewer_security` security audit (CORS restriction, server-only secret storage, payload length limit, CSS injection prevention).
