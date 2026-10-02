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

## Phase 7: Free Model Support, 1000-Char Limit & Live Auto-Update
- [x] 7.1: Integration of Fish Audio `s2.1-pro-free` model with custom voice reference (`37f9f4eec7624089a49b188d47588f2c`).
- [x] 7.2: Expansion of TTS reading limit to 1000 characters (`twitchSanitizer`, server proxy, Vercel serverless function).
- [x] 7.3: Adaptive card UI with dynamic font scaling (text-lg / text-base / text-sm) and scroll containment for OBS.
- [x] 7.4: Resilient watchdog timer scaling (proportional to message length up to 180s) preventing premature cutoffs.
- [x] 7.5: Zero-touch OBS auto-updater checking deployment build hash via `/api/version` to reload active browser sources automatically.

## Phase 8: Vocal Emotion & Expression System
- [x] 8.1: Dedicated `emotionMapper.ts` with Spanish-English bidirectional synonym dictionary for Fish Audio S2 tags.
- [x] 8.2: Extraction of primary emotion (`extractPrimaryEmotion`) and real-time normalization (`normalizeTextForFishAudio`).
- [x] 8.3: OBS Widget visual emotion insignia badge in card header with emoji, label, and themed color glows.
- [x] 8.4: Inline expression formatting in OBS text with glowing purple accent pills (`renderMessageContent`).
- [x] 8.5: Fallback safety: Web Speech API removes bracket tags to prevent literal reading when offline.
- [x] 8.6: Streamer Dashboard interactive emotion suite: quick-test buttons, live insignia preview, and viewer guide.
- [x] 8.7: Comprehensive unit tests in `emotionMapper.test.ts` (16/16 tests passing).
## Phase 9: GSAP Kinetic Text & Talking Avatar Animation System
- [x] 9.1: Kinetic Text Animation: Tokenization into `.msg-word` elements with staggered GSAP reveal (`staggerSpeed = Math.max(0.01, Math.min(0.035, 0.9 / words.length))`), scale, and subtle blur filter.
- [x] 9.2: Talking Avatar Micro-Motion: Dynamic vocal bouncing (`scale: 1.07`, `y: -2.5`, `rotation: random(-1.2, 1.2)`) synchronized with audio playback (`startSpeakingAnimation`).
- [x] 9.3: Soundwave Acoustic Aura: Concentric pulse rings (`talking-aura-ring`) radiating outward from the avatar.
- [x] 9.4: Resonant Ambient Glow: Card backlight breathing dynamically to the cadence of the speech.
- [x] 9.5: 7-Bar Harmonic Audio Equalizer: Organically randomized multi-frequency frequency bars.
- [x] 9.6: Coordinated Exit Timeline: Smooth staggered word ascension combined with card fade-out.
## Phase 10: Smart Semantic Chunking & Long-Form Reading Engine
- [x] 10.1: Smart Semantic Chunking (`splitTextIntoSemanticChunks`): Decomposes long text (>260 chars) along sentence/clause boundaries (`.`, `!`, `?`, `;`, `,`) without cutting words.
- [x] 10.2: Vocal Emotion Tag Propagation: Automatically prepends active emotion tags (`[happy]`, etc.) to subsequent chunks to ensure consistent tone across the entire reading.
- [x] 10.3: Parallel Concurrent Audio Synthesis: Executes all chunks in parallel using `Promise.all` and concatenates MP3 byte streams with `Buffer.concat`, cutting generation latency by ~60%.
- [x] 10.4: Vercel Max Duration: Configured `maxDuration: 60` and `MAX_TTS_LENGTH: 2000` in serverless function preventing 502/504 timeouts.
- [x] 10.5: Adaptive Visual Container & Typography: Upgraded card to `max-h-[28rem]` with fluid font scaling (`text-xs` for >650 chars down from `text-lg`).
- [x] 10.6: Kinetic GSAP Auto-Scroll: Dynamically advances the text container smoothly down to the bottom while audio is speaking if text exceeds card height.
- [x] 10.7: Extended Safety Watchdog: Proportional watchdog timer (`Math.max(20000, text.length * 250)`) ensuring 1000-character audio plays completely to the very last word.
## Phase 11: Singing Voice Optimization & Prosody Alignment
- [x] 11.1: Spanish Singing Tag Expansion: Added aliases (`canta`, `cantar`, `cantando`, `canción`, `cancion`, `tarareo`, `tararear`, `musica`, `música`, `melodia`, `melodía`, `musical`) to `emotionMapper.ts`, `api/tts.ts`, and `server/ttsHandler.ts`.
- [x] 11.2: Dedicated Singing Phrasing: Formatted announcement as `"{user} canta."` with period sentence boundary instead of colon to prevent breaking Fish Audio's musical prosody.
- [x] 11.3: Natural Song Preview & Test Defaults: Updated Dashboard "🎵 Cantando" button to prefill a realistic singing verse (`Cumpleaños feliz, te deseamos a ti, que los cumplas muy feliz`) instead of dry prose.
- [x] 11.4: Unit Test Coverage: Added verification test for all singing variants in `tests/emotionMapper.test.ts` (17/17 tests passing).

## Phase 12: Zero-Downtime Remote OBS Live Stream Synchronization
- [x] 12.1: Robust URL Sanitization: Strict stripping of trailing punctuation (`.`, `,`, `;`, `/`, `\`) on query params (`model=s2.1-pro-free.`), ensuring full backward compatibility with active browser source URLs.
- [x] 12.2: Remote OBS Force-Reload Button: Added 1-click "Actualizar OBS" action in Dashboard header broadcasting `{ type: 'FORCE_RELOAD' }` across `BroadcastChannel('lalo_tts_bus')`.
- [x] 12.3: Broadcaster / Mod Chat Command: Regex matcher in `useTwitchChat.ts` for `!s reload`, `!s update`, `!s actualizar`, `!s reiniciar` with optional punctuation.
- [x] 12.4: Accelerated Hot Poller: 15-second polling interval and 30-second cooldown in `Widget.tsx` using `/api/version` (supporting `VERCEL_DEPLOYMENT_ID` and `VERCEL_GIT_COMMIT_SHA`).
- [x] 12.5: Express & Serverless Parity: Added `/api/version` to local Express development server.

## Phase 13: Lalo Stream Suite Hub & Stream Alerts Module (Impeccable & Emil Kowalski Design)
- [x] 13.1: Unified Suite Navbar (`src/components/SuiteNav.tsx`): Persistent top navigation with segmented app switcher (Catálogo, TTS, Alertas), channel status indicator, 1-click OBS Browser Source copy modal, and ThemeSwitch.
- [x] 13.2: Studio Tools Catalog Dashboard (`src/pages/Catalog.tsx`): Command center showcasing suite tools (Lalo TTS, Lalo Alertas, Bot & Moderación, Metas, Ruleta) with GSAP `useGSAP` staggered entrance, micro-interactions, and active states (`scale(0.97)`).
- [x] 13.3: Stream Alerts Studio (`src/pages/AlertsStudio.tsx`): Dedicated studio for Follows, Subscriptions, Bits, and Raids; custom templates with token interpolation, 4 Cabina styles, position quadrant, duration, and volume controls.
- [x] 13.4: Zero-Latency Web Audio API Synthesizer (`src/utils/alertsAudio.ts`): Built-in harmonic chimes (Synth Bell, Retro Fanfare, Arcade Chime, Soft Pop) with zero network latency and no CORS issues.
- [x] 13.5: Multi-App Hash Router (`src/App.tsx`): Seamless switching between `#catalogo`, `#tts`, `#control`, `#alertas`, and OBS `#widget`.
- [x] 13.6: Real-Time Bus & OBS Overlay Integration (`src/utils/bus.ts` & `src/pages/Widget.tsx`): Live dispatch of `ALERT_TRIGGER` events from the studio to OBS overlays.
- [x] 13.7: Quality Gates & Verification: 41/41 unit tests passing in Vitest (`tests/alerts.test.ts`), `tsc --noEmit` clean, and production build succeeded.

## Phase 14: TwitchIO Bot & EventSub Engine Integration (PythonistaGuild Attribution)
- [x] 14.1: Technical Analysis & Attribution: Evaluated Python framework TwitchIO (https://github.com/TwitchIO/TwitchIO); embedded prominent credits and attribution to creators **PythonistaGuild** & **EvieePy** under the **MIT License**.
- [x] 14.2: TwitchIO Studio Surface (`src/pages/TwitchIOStudio.tsx`): Dedicated studio with Cabina hardware styling, official attribution hero card, command manager (permissions, cooldowns, toggles), EventSub gateway monitors, and interactive chat console simulator.
- [x] 14.3: Asynchronous Python Bridge Script (`server/twitchio_bridge.py`): Standalone bridge connecting TwitchIO IRC and EventSub with the local Lalo Express server via `POST /api/twitchio/event`.
- [x] 14.4: Express Server Webhook Receptor (`server/index.ts`): Added `POST /api/twitchio/event` to ingest live TwitchIO bridge events.
- [x] 14.5: Navigation & Catalog Activation (`src/components/SuiteNav.tsx` & `src/pages/Catalog.tsx`): Activated "Bot (TwitchIO)" tab in navigation and promoted the Catalog tool card from "Próximamente" to "DISPONIBLE (Powered by TwitchIO)".
- [x] 14.6: Verification & Test Suite (`tests/twitchio.test.ts`): 44/44 unit tests passing, `tsc --noEmit` clean, and production build verified.

## Phase 15: Suite Dashboard Stabilization & Custom Media / Channel Points FX Architecture
- [x] 15.1: Fixed GSAP React 19 StrictMode bug in `src/pages/Catalog.tsx` (migrated from `tl.from()` to `tl.fromTo()` with `clearProps: 'transform,opacity'` preventing cards from becoming permanently invisible at `opacity: 0`).
- [x] 15.2: Stabilized routing and navbar in `src/App.tsx` and `src/components/SuiteNav.tsx` (promoted Hub to "Dashboard", unified route `#dashboard` / `#/dashboard` / `#catalogo` / `/`, and ensured tactile `active:scale-[0.97]` feedback).
- [x] 15.3: Added Module 4 Showcase Card to `src/pages/Catalog.tsx`: "Puntos de Canal & FX Personalizados (Estilo StreamElements)" with 1-click test simulation.
- [x] 15.4: Architectural specification for transparent WebM videos, chroma keying, screen shake, audio layers, and OBS WebSocket v5 triggers.

## Phase 16: Rewards Library Studio & Transparent Video Overlay System
- [x] 16.1: Fixed navigation priority in `src/App.tsx`: App routes (`#tts`, `#alertas`, `#recompensas`, `#twitchio`) now take absolute precedence over `search.includes('channel=')`, resolving the issue where URL query params trapped navigation on a blank OBS widget.
- [x] 16.2: Fixed active tab highlight in `src/pages/TwitchIOStudio.tsx`: Set `currentApp="twitchio"` on `SuiteNav` so the "Bot" tab highlights correctly instead of "Catálogo".
- [x] 16.3: Built Rewards Studio (`src/pages/RewardsStudio.tsx`): 16:9 interactive live simulation stage, local file uploader (`.webm` with alpha channel and `.mp4`), blend mode selector (WebM Alfa, Screen blend, Chroma green), position quadrants, scale, volume, and Screen Shake toggle.
- [x] 16.4: Transparent Video Overlay Engine in OBS Widget (`src/pages/Widget.tsx`): Real-time `REWARD_TRIGGER` handler, elastic GSAP camera shake (`elastic.out(1.2, 0.18)`), transparent video playback, and custom broadcast notice banners.
- [x] 16.5: SuiteNav & Catalog Integration: Added dedicated "Recompensas" tab (`#recompensas`) to `SuiteNav.tsx` and activated direct button in `Catalog.tsx`.
- [x] 16.6: Quality Gates & Verification: 49/49 unit tests passing (`tests/rewards.test.ts`), `tsc --noEmit` clean, and production build succeeded.

## Phase 17: Video & Meme Integration in Stream Alerts (Follows, Subs, Bits, Raids)
- [x] 17.1: Data Model Expansion (`src/types/alerts.ts`): Extended `EventRuleConfig` with `videoUrl`, `videoName`, `blendMode`, `videoScale`, and `screenShake`.
- [x] 17.2: Stream Alerts Studio (`src/pages/AlertsStudio.tsx`): Integrated dedicated Video Transparente / Meme upload section into each event tab (Follow, Sub, Bits, Raid) with blend mode selector (WebM Alfa, Screen, Chroma Key) and Screen Shake toggle.
- [x] 17.3: 16:9 Live Monitor Simulation: Synchronized video playback and physical GSAP screen shake in the studio monitor when clicking "Probar Alerta" or "Reproducir Animación".
- [x] 17.4: OBS Overlay Synchronization (`src/pages/Widget.tsx`): Enhanced `ALERT_TRIGGER` receptor to parse and display video overlays, volume, and trigger elastic camera vibrations in OBS Browser Source.
- [x] 17.5: Verification: 49/49 Vitest unit tests passing (`tests/alerts.test.ts`), `tsc --noEmit` clean, and production build verified.

## Phase 18: Custom Audio Engine in Alerts & Channel Points Rewards
- [x] 18.1: Unified Audio Engine (`src/utils/alertsAudio.ts`): Built `playCustomAudio(audioUrl, volume)` and `playAlertOrCustomSound(customAudioUrl, fallbackSoundType, volume)` supporting Base64/Data URI and local uploads (`.mp3`, `.wav`, `.ogg`) alongside zero-latency synthesized web audio chimes.
- [x] 18.2: Custom Audio in Stream Alerts (`src/pages/AlertsStudio.tsx`): Integrated audio upload input, audio preview playback ("Escuchar"), individual gain sliders, and remove button across all event tabs (Follow, Sub, Bits, Raid).
- [x] 18.3: Custom Audio in Channel Points Rewards (`src/pages/RewardsStudio.tsx`): Added audio upload inspector card, quick playback button, and gain slider so channel rewards can trigger both custom fanfare sounds and transparent WebM alpha videos.
- [x] 18.4: Live OBS Studio Synchronization (`src/pages/Widget.tsx` & `src/utils/bus.ts`): Transmitted `customAudioUrl` and `customAudioVolume` across the BroadcastChannel bus for immediate playback in OBS Browser Source.

## Phase 19: Tiered Bits & Subscriptions Personalization Actions
- [x] 19.1: Tiered Architecture (`src/types/alerts.ts`): Modeled `BitTierConfig` (Bronze 1-99, Silver 100-499, Gold 500-999, Diamond/Hype 1000+) and `SubTierConfig` (Tier 1, Tier 2, Tier 3, and Community Gift Subs).
- [x] 19.2: Tier Customization & Interactive Simulation (`src/pages/AlertsStudio.tsx`): Integrated tier inspection, 1-click test triggers (`broadcastTierBits`, `broadcastTierSub`), custom accent colors, screen shake flags, and individual templates.
- [x] 19.3: Backward Compatibility: Enhanced `loadAlertsSettings()` to guarantee default bit and sub tiers populate seamlessly for existing localStorage user profiles.

## Phase 20: Metas Comunitarias & Marcadores Studio (Goals Studio - Module 5)
- [x] 20.1: Goals Data Architecture (`src/types/goals.ts`): Modeled `CommunityGoalItem` for Sub Goals, Follower Goals, and Bit Goals with custom units, progress limits, style presets (Cabina, Neón Glow, Cyberpunk, Minimalist), and 100% celebration triggers.
- [x] 20.2: State Management Hook (`src/hooks/useGoalsSettings.ts`): Created reactive hook with local storage persistence and real-time `GOAL_UPDATE` / `GOAL_CELEBRATE` bus dispatch.
- [x] 20.3: Goals Studio (`src/pages/GoalsStudio.tsx`): Dedicated studio with 16:9 monitor, GSAP fluid progress bar physics, interactive advance buttons (+1, +5, +25, reset), canvas confetti particle shower, transparent victory video, seismic camera shake, and custom MP3 victory fanfare audio.
- [x] 20.4: OBS Browser Source Overlay (`src/pages/Widget.tsx`): Added dedicated goal bar overlay when `?app=goals` or `#widget?app=goals` is requested, plus milestone celebration handling.
- [x] 20.5: Navigation & Catalog Activation: Added `#metas` route to `src/App.tsx`, Metas tab to `src/components/SuiteNav.tsx`, and promoted Module 5 to `DISPONIBLE` in `src/pages/Catalog.tsx`.
## Phase 21: Media Vault 30s Strict Audio Architecture, Stream Events Customization & Vercel Production Readiness
- [x] 21.1: Strict 30s Audio Engine & Format Validation (`src/types/mediaLibrary.ts`): Implemented `MAX_AUDIO_DURATION_SECONDS = 30.0` and `inspectAudioFile()` to measure audio duration via `Audio.onloadedmetadata` with friendly user rejection banners for files > 30s.
- [x] 21.2: Central Media Vault System (`src/components/MediaLibraryModal.tsx` & `src/hooks/useMediaLibrary.ts`): Built interactive modal with live search, category chips, audio preview playback, drag-and-drop uploader, duration badges, and 1-click item assignment.
- [x] 21.3: Audio Modes in Stream Alerts (`src/pages/AlertsStudio.tsx`): Integrated 4 distinct audio modes (`synth`, `custom_audio`, `tts`, `both`), allowing streamers to choose between synthesized Web Audio chimes, uploaded audio clips (<= 30s), spoken TTS voice, or both (intro sound + speech).
- [x] 21.4: Custom Stream Events System (`src/pages/AlertsStudio.tsx`): Built full CRUD manager for custom chat triggers (e.g. `!hypetrain`, `!secreto`), custom templates, audio modes, screen shake, accent colors, and 1-click test dispatch to OBS.
- [x] 21.5: Unified Suite Media Integration: Wired `MediaLibraryModal` into `AlertsStudio.tsx`, `RewardsStudio.tsx`, and `GoalsStudio.tsx`, providing seamless access to the streamer's media vault for audio fanfares and transparent videos.
- [x] 21.6: OBS Overlay Speech & Sound Routing (`src/pages/Widget.tsx`): Updated `ALERT_TRIGGER` receptor to honor `audioMode`, playing audio bites and selectively enqueuing TTS speech synthesis based on mode.
- [x] 21.7: Vercel Deployment & Serverless Integration: Prepared `vercel.json` SPA rewrites and serverless endpoints (`api/tts.ts`, `api/health.ts`, `api/version.ts`, `api/twitchio.ts`).
- [x] 21.8: Quality Gates & Testing: Added `tests/mediaLibrary.test.ts` (61/61 unit tests passing across 9 test suites), `npx tsc --noEmit` 0 errors, and production build succeeded in 5.91s.

## Phase 22: Multi-Metas Simultáneas, Compresión ≤4 en Fila, Carrusel Rotativo GSAP (5+ Metas) y Anuncios TTS
- [x] 22.1: Multi-Goals Data Modeling (`src/types/goals.ts`): Modeled `GoalsDisplayMode` (`auto_4_or_slideshow`, `slideshow_only`, `row_only`, `reactive_progress`, `single_active`), `shouldDisplayAsSlideshow()`, milestone detection `checkMilestoneCrossed()` (25%, 50%, 75%, 100%), and speech announcement scripts `formatMilestoneAnnouncement()` and `formatProgressAnnouncement()`.
- [x] 22.2: Unified Goals Overlay Component (`src/components/goals/GoalsOverlayView.tsx`): Built multi-goal layout supporting all 4 styles (Cabina, Neón, Cyberpunk, Minimalist), automatic visual compression for 1 to 4 goals in a row, and animated slideshow carousel with GSAP (smooth slide in `y: 8 -> 0`, subtle blur crossfade, live cycle countdown timer bar, and interactive pill indicators) when reaching 5+ goals.
- [x] 22.3: Goals Studio Interactive Control (`src/pages/GoalsStudio.tsx`): Replaced single-goal preview with `GoalsOverlayView` in the 16:9 monitor, added display mode selector cards, slideshow interval slider (3s-30s), TTS announcements toggles, active/paused toggles per goal, simulation advance buttons with voice announcements, and 1-click "Probar Umbral 5+ Metas" button.
- [x] 22.4: Realtime Bus & OBS Synchronization (`src/hooks/useGoalsSettings.ts`, `src/utils/bus.ts`, `src/pages/Widget.tsx`): Sincronización instantánea de `GOALS_SETTINGS_UPDATE` y `GOAL_UPDATE`, con renderizado unificado en la fuente de navegador de OBS y locución hablada TTS de avances e hitos.
- [x] 22.5: Design Skills Compliance: Adhered to `impeccable` (broadcast hardware aesthetic, high visual contrast), `emil-design-eng` (interactive `active:scale-[0.97]`, transitions < 250ms, no animations from `scale(0)`), and `gsap` (smooth timelines and timer bar tween).
- [x] 22.6: Verification & Quality Gates: Expanded `tests/goals.test.ts` (15/15 goals tests, 72/72 total tests passing across 9 test suites), `npx tsc --noEmit` 0 errors, and Vite production build verified.

