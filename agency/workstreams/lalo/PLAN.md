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

## Phase 23: Sistema de Tutoriales Guiados (GuidedTour) Universal para Toda la Suite
- [x] 23.1: GuidedTour Component Enhancement (`src/components/GuidedTour.tsx`):
  - Added support for category `badge` on steps (e.g., 'Bienvenida', 'Acción del Sistema', 'Previsualización', 'Gestión').
  - Added `appName` in dock header (e.g., 'Estación Central', 'Estudio de Alertas', 'Recompensas & FX', 'Metas & Marcadores', 'Bot TwitchIO').
  - Integrated Emil Kowalski micro-craft: Web Audio API sound cue oscillator for step transitions (sweet sine chime at 520Hz) and tour completion (major-third triad fanfare), faster exit (180ms) vs entrance (400ms), and subtle `filter: blur(2px)` crossfades.
  - Added full keyboard accessibility (`ArrowRight`, `ArrowLeft`, `Escape`) with active text-input and modal guards.
  - Exported `isTourDone(id)`, `markTourDone(id)`, and `resetTour(id)` with independent localStorage keys per application.
- [x] 23.2: Universal Suite Integration:
  - `src/pages/Catalog.tsx`: 10-step guided tour (`CATALOG_TOUR_STEPS`, id `'catalogo'`) explaining every module, system actions (OBS quick URLs, global channel switcher), and launch buttons.
  - `src/pages/AlertsStudio.tsx`: 9-step guided tour (`ALERTS_TOUR_STEPS`, id `'alertas'`) covering Follow, Sub, Bit, and Raid events, audio modes (synth, custom, tts, both), WebM alpha transparent videos, tier customization, and 16:9 live monitor simulation.
  - `src/pages/RewardsStudio.tsx`: 7-step guided tour (`REWARDS_TOUR_STEPS`, id `'recompensas'`) covering channel point rewards, transparent videos, blend modes, screen shake, audio fanfares, and OBS browser source embedding.
  - `src/pages/GoalsStudio.tsx`: 7-step guided tour (`GOALS_TOUR_STEPS`, id `'metas'`) explaining multi-goal progression, display modes, automatic GSAP slideshow rotation for 5+ goals, milestone speech announcements, and 100% victory celebrations with canvas confetti.
  - `src/pages/TwitchIOStudio.tsx`: 7-step guided tour (`TWITCHIO_TOUR_STEPS`, id `'twitchio'`) covering TwitchIO bot architecture (PythonistaGuild & EvieePy), chat commands, permissions, EventSub gateway, interactive simulator console, and Python 3.9+ script generator.
- [x] 23.3: Navbar Accessibility (`src/components/SuiteNav.tsx`):
  - Connected `onOpenTour` and `tourAvailable` across all pages, allowing streamers to re-open the guided tour at any time via the "Guía" button in the header.
  - Set `paddingBottom: tourOpen ? 220 : undefined` on main container elements so the fixed floating dock never obscures interactive controls during the tour.
- [x] 23.4: Quality Gates & Test Suite:
  - Created `tests/guidedTour.test.ts` testing storage persistence, independent app keys, reset behavior, and step structure contracts.
  - Vitest test suite: 10/10 test files passing (78 tests total).
  - TypeScript & Vite build: `tsc && vite build` clean with 0 errors.

## Phase 24: Ruleta de Castigos & Retos Interactiva (Roulette Studio - Module 6)
- [x] 24.1: Data Architecture & Geometric Angular Mathematics (`src/types/roulette.ts`):
  - Modeled `RouletteSegment`, `PenaltyCategory` ('fitness', 'voice', 'gameplay', 'food', 'show', 'safe', 'custom'), `RouletteStyle` ('cabina', 'neon', 'cyber', 'gold'), `RoulettePreset`, and `RouletteSettings`.
  - Implemented 4 themed pre-built packs: *Castigos Gamer*, *Castigos Físicos & Fitness*, *Show, Voz & Actuación*, and *Sabores & Retos Picantes*.
  - Mathematical & physical calculation engine: `getSegmentAngle`, `polarToCartesian`, `describeArc` (SVG wedge paths), `calculateTargetRotation` (forward inertia with min 5-8 full 360° spins and continuous rotational continuity), and `pickRandomSegment`.
  - Storage persistence: `loadRouletteSettings()` and `saveRouletteSettings()` with safe fallback handling.
- [x] 24.2: Mechanical Audio Synthesizer Engine (`src/utils/rouletteAudio.ts`):
  - Zero-dependency Web Audio API synthesizer for physical feedback.
  - `playWheelTick(volume, pitchScale)`: 20ms high-passed triangle click with dynamic pitch scaling that prevents auditory fatigue during deceleration.
  - `playWheelFanfare(volume)`: Major-triad harmonic fanfare with envelope shaping upon stopping.
- [x] 24.3: High-Definition Vector Wheel Component (`src/components/roulette/RouletteWheel.tsx`):
  - 440x440 SVG vector wheel with Cabina Broadcast chasis, LED perimeter indicators, metallic pegs, and radial text labels with category icons.
  - Physical deceleration with GSAP `power4.out`, needle flipper bounce (`elastic.out(1.8, 0.3)`), and boundary tick audio synchronization.
- [x] 24.4: Dramatic Winner / Penalty Reveal Card (`src/components/roulette/WinnerBanner.tsx`):
  - Dramatic entrance animation with GSAP `back.out(1.6)` and exit with `power2.in`.
  - Category badges, intensity markers, interactive countdown timer for timed challenges (e.g., 45s, 60s) with live progress bar and pause/resume/reset controls.
- [x] 24.5: Broadcast Bus & OBS Browser Source Integration (`src/utils/bus.ts` & `src/pages/Widget.tsx`):
  - Extended event bus with `RouletteSpinEvent`, `ROULETTE_SETTINGS_UPDATE`, `ROULETTE_SPIN`, `ROULETTE_CLEAR`.
  - Transparent OBS Browser Source overlay (`?app=roulette` or `#widget?app=roulette`), auto-triggering on broadcast with camera shake and winner card.
- [x] 24.6: Dedicated Roulette Studio Page (`src/pages/RouletteStudio.tsx`):
  - 16:9 monitor with live spin trigger, preset selector, full segment CRUD manager with category pills and color pickers.
  - Visual theme selector (Cabina, Neón, Cyberpunk, Oro VIP), spin duration slider (3s-15s), tick volume, Media Vault custom victory audio integration, and OBS link generator.
  - Interactive Guided Tour (`ROULETTE_TOUR_STEPS`, id `'ruleta'`) with 8 steps.
- [x] 24.7: Navigation, App Routing & Catalog Activation:
  - Added `#ruleta` / `#wheel` / `#castigos` routes to `src/App.tsx`.
  - Added Ruleta tab with `Gamepad2` icon and "NUEVO" badge to `src/components/SuiteNav.tsx`.
  - Promoted Module 6 from "Próximamente" to `DISPONIBLE` in `src/pages/Catalog.tsx` with test trigger and OBS copy button.
- [x] 24.8: Quality Gates & Testing:
  - Created `tests/roulette.test.ts` (19/19 tests passing) testing segment angles, SVG arcs, forward inertia, target rotation, presets, and storage persistence.
  - Full test suite: 11/11 test files passing (97 tests total).
  - TypeScript & Vite build: `tsc && vite build` clean with 0 errors.

## Phase 25: Estabilización de Física de Ruleta GSAP & Sistema de Comandos y Audio de Moderación en TTS
- [x] 25.1: Estabilización de Física Inercial de la Ruleta (`src/components/roulette/RouletteWheel.tsx` & `src/types/roulette.ts`):
  - Identificada la causa de giros erráticos: `power4.out` desaceleraba el 97% del recorrido en 2s arrastrándose 4s, la llamada a `gsap.set` 60 veces/s dentro de `onUpdate` producía micro-tirones y acumulación de miles de grados desfasaba a OBS.
  - Migrado a animación directa en GPU sobre `wheelGroupRef.current` con curva broadcast `power3.out`.
  - Normalizado el ángulo de reposo en $[0, 360)$ con 5 giros exactos y sincronización de `startRotation` hacia OBS vía `RouletteSpinEvent`.
  - Regulador percutivo de clicks mecánicos (límite de frecuencia de 35ms) y deflexión con `overwrite: 'auto'` en la aguja para evitar bloqueos y chasquidos de audio.
- [x] 25.2: Desbloqueo y Soporte Completo de Comandos para Moderadores en TTS (`src/utils/moderation.ts` & `src/hooks/useTwitchChat.ts`):
  - Detección exhaustiva de insignias de moderador (`lead_moderator`, `user-type=mod`, `tags.mod === '1'`, `tags.isMod`).
  - Flexibilización de sintaxis: se admiten tanto `!s <comando>` como el comando directo `!<comando>` (`!skip`, `!pausa`, `!pause`, `!reanudar`, `!resume`, `!clear`, `!silencio`, `!panic`, `!timeout @user`, `!block @user`, `!reload`).
  - Privilegio de habla en `classifyTrigger`: broadcasters y mods pueden enviar TTS mediante `!s <texto>` incluso si los comandos públicos (`commandEnabled`) están apagados.
- [x] 25.3: Motor de Audio y Notificación para Moderación (`src/utils/moderationAudio.ts` & `src/pages/Widget.tsx`):
  - Sintetizador táctico Web Audio API `playModerationChime()` (intercom bip dual G5 -> C6).
  - Locución sintética ágil `announceModerationAction()` anunciando en español la acción y el moderador que la ejecutó.
  - Toast HUD con estética broadcast de alta visibilidad (`[🛡️ MODERACIÓN: {acción} • por {moderador}]`) con animación GSAP en la escena de OBS.
- [x] 25.4: Verificación y Quality Gates:
  - 11 suites de prueba unitarias ejecutadas con éxito (98/98 tests passing).
  - Compilación TypeScript y empaquetado Vite limpio con 0 errores.

## Phase 26: Instalación y Disponibilidad de Skills en Workspace (Impeccable & GSAP Suite)
- [x] 26.1: Instalación de Skills en `.agents/skills/` (Antigravity Spec):
  - `impeccable`: Guía completa de diseño, arquetipos, accesibilidad, tipografía, paletas de color y revisión de interfaces broadcast.
  - Suite modular GSAP: `gsap-core`, `gsap-react`, `gsap-timeline`, `gsap-plugins`, `gsap-scrolltrigger`, `gsap-performance`, `gsap-utils`, `gsap-frameworks`.
  - `emil-design-eng`: Principios de micro-interacciones, feedback háptico/auditivo, estados activos (`active:scale-[0.97]`), y transiciones rápidas e imperceptibles.
- [x] 26.2: Replicación en `.claude/skills/` (TheAgency Framework Spec):
  - Desplegadas en `.claude/skills/` para consumo directo por los subagentes del framework (`captain`, `tech_lead`, `reviewer_code`).
- [x] 26.3: Verificación del Sistema y Quality Gates:
  - 11 suites de pruebas ejecutadas con 98/98 tests pasando.
  - Verificación de TypeScript (`tsc`) y empaquetado Vite para producción exitoso.

## Phase 27: Batallas & Encuestas Cinemáticas en Vivo (Polls & Versus Studio - Módulo 7)
- [x] 27.1: Arquitectura de Datos y Parser de Votación (`src/types/polls.ts`):
  - Modelos `PollOption`, `PollSettings`, `PollBattlePreset` y `TtsEmotionConfig`.
  - Parser multilingüe de chat `parseVoteCommand`: reconoce `!voto 1`, `!voto 2`, `!voto a`, `!voto b`, `!vote 1`, `!vote 2` y sintaxis rápida `!1`, `!2`, `!a`, `!b`.
  - Helpers matemáticos: `calculatePollPercentages` (suma estricta 100%), `determineLeader` y persistencia `loadPollSettings` / `savePollSettings`.
  - 4 plantillas temáticas preconfiguradas: *¿Qué jugamos hoy?*, *Penitencia Inmediata del Chat*, *Cena Nocturna del Streamer*, *Juicio Final (Salvar o Sacrificar)*.
- [x] 27.2: Motor Táctil de Audio Web Audio API y Locución Emocional TTS (`src/utils/pollsAudio.ts`):
  - Ticks de voto diferenciados: Opción 1 brillante (660Hz -> 880Hz) vs Opción 2 cálido (440Hz -> 554Hz) para retroalimentación táctil-auditiva sin mirar la pantalla.
  - Impact Clash con sub-bajo (130Hz -> 45Hz) y chispazo metálico (1600Hz -> 900Hz) ante cambios de líder.
  - Beeps de cuenta regresiva para los últimos 10 y 5 segundos, y fanfarria triunfal polifónica.
  - Locutor con tags emocionales: `[emocionado]` en cambio de líder, `[susurro]` en últimos 10s, `[triunfal]` en coronación del ganador y `[tenso]` en empate.
- [x] 27.3: Componente de Barra Líquida Clashing con GSAP (`src/components/polls/BattleBarView.tsx`):
  - Barras reactivas fluidas con curvatura elástica `power2.out`, medallón central «VS» con destello y sacudida `back.out(2)`, y tipografía tabular de alto contraste.
- [x] 27.4: Hook de Gestión y Sincronización en Tiempo Real (`src/hooks/usePollsSettings.ts` & `src/utils/bus.ts`):
  - Deduplicación de votantes por espectador con soporte configurable de cambio de voto (`allowVoteChange`).
  - Sincronización continua de eventos por BroadcastChannel (`POLL_STATE_UPDATE`, `POLL_VOTE`, `POLL_TTS_CUE`, `POLL_CLEAR`).
- [x] 27.5: Integración con Twitch Chat e IRC (`src/hooks/useTwitchChat.ts`):
  - Detección automática de votos del chat de Twitch en vivo y emisión instantánea al bus.
- [x] 27.6: Overlay Transparente para OBS Studio (`src/pages/Widget.tsx`):
  - Soporte de renderizado en OBS para `?app=polls`, `?app=versus` o `#widget?app=polls` con animación GSAP flotante y audio sincronizado.
- [x] 27.7: Mesa de Control Broadcast y Navegación (`src/pages/PollsStudio.tsx`, `src/App.tsx`, `src/components/SuiteNav.tsx`, `src/pages/Catalog.tsx`):
  - Monitor 16:9 con simulación en tiempo real, botones de voto directo, ráfaga masiva (+aleatorio), selectores de presets, botones para probar la voz con emoción y generador de URL OBS.
  - Pestaña «Batallas» con badge `PREVIEW` en `SuiteNav` y Módulo 7 activo en `Catalog`.
## Phase 28: Overhaul Visual Esports en Batallas, Voces de Personajes y Locución Emocional del Sistema
- [x] 28.1: Overhaul Visual y Animaciones de Batalla Cinemática Esports (`src/components/polls/BattleBarView.tsx`):
  - Chasis angular estilo arena esports con cortes geométricos, corchetes de esquina y gradientes perimetrales de alta energía.
  - Barras líquidas con interpolación GSAP fluida y números rodantes (*rolling numbers*) a 60fps sin tirones de layout.
  - Anillo de choque sónico (*shockwave ring*) en el medallón VS y partículas de chispas en colisión de porcentajes.
  - Anillo circular SVG de cuenta regresiva con cálculo de perímetro reactivo.
  - Cartel de victoria dramática con entrada elástica y badge de corona dorada.
- [x] 28.2: Integración de Voz de Fish Audio del Sistema en Batallas (`src/utils/pollsAudio.ts` & `src/pages/PollsStudio.tsx`):
  - El locutor emocional de batallas utiliza directamente la voz configurada por el streamer en TTS (`referenceId`), en vez de una voz aleatoria o del navegador.
  - Petición directa a `/api/tts` con etiquetas de modulación emocional (`[emocionado]`, `[susurro]`, `[triunfal]`) y fallback fluido a Web Speech API.
  - Badge visual en `PollsStudio.tsx` indicando el personaje activo con enlace de 1-click hacia `#tts`.
- [x] 28.3: Nuevas Voces Predefinidas de Personajes en TTS (`src/types/settings.ts` & `src/pages/Dashboard.tsx`):
  - Reemplazadas las voces anteriores exclusivamente por los 5 personajes solicitados:
    - **Teemo** (ID: `5669f8e58ecb476a982bc2b67ac6b538`)
    - **Ahri** (ID: `31dbd39039854d379d1d692a6a97451d`)
    - **Jarvis** (ID: `59fb1f7a5e69481387cc280b9d2b3ad8`)
    - **Diana** (ID: `37f9f4eec7624089a49b188d47588f2c`) - *Por defecto*
    - **Luz** (ID: `654e33e85be3406d90b9723712a035a9`)
    - Opción manual: **Usar ID propio**.
- [x] 28.4: Quality Gates y Suite de Pruebas:
  - 12 suites de prueba unitarias ejecutadas con éxito (113/113 tests pasando en Vitest).
  - Verificación estricta de tipos con `tsc --noEmit` y empaquetado de producción Vite verificado con 0 errores.

## Phase 29: Rediseño Visual de Alta Definición de la Ruleta (Impeccable & Emil), Locución TTS de Giro y Resultados, y Overlay Cinemático para OBS
- [x] 29.1: Overhaul Visual y Mecánico de la Ruleta (`src/components/roulette/RouletteWheel.tsx`):
  - Chasis multicapa con bisel industrial 3D, degradados metálicos y corona central turbine-hub con gema reflectante.
  - 28 LEDs perimetrales animados con persecución estroboscópica durante el giro y reposo con respiración suave.
  - Cuñas con sombreado cónico tridimensional, relieves luminosos, tipografía con doble sombra y emojis de categoría.
  - Clavijas perimetrales 3D con cuerpo metálico cilíndrico, sombras proyectadas y reflejos especulares de luz.
  - Aguja mecánica flipper aerodinámica tipo daga con doble bisel 3D, núcleo carmesí brillante, pivote cromado y rebote elástico `elastic.out(2.2, 0.25)`.
  - Micro-retroceso físico de inercia al clavar el perno, onda expansiva shockwave y partículas de chispas en el punto de contacto.
- [x] 29.2: Locución Emocional TTS Integrada (`src/utils/rouletteAudio.ts` & `src/types/roulette.ts`):
  - `speakRouletteSpinAnnouncement`: Anuncia con voz emocionada del sistema (`[emocionado]`) que la ruleta va a girar y qué penitencia tocará.
  - `speakRouletteWinnerAnnouncement`: Proclama con modulación dramática (`[triunfal]`, `[alegria]`, `[sorprendido]`) el castigo o reto seleccionado, informando tiempo o inmunidad.
  - Sonido whoosh cinemático sintetizado con Web Audio API al iniciar el giro.
  - Enrutamiento directo al endpoint `/api/tts` con la voz oficial de Fish Audio configurada en el sistema (Diana, Jarvis, Teemo, Ahri, Luz, etc.) y fallback a SpeechSynthesis.
- [x] 29.3: Overlay Cinemático para OBS Studio (`src/components/roulette/RouletteOverlayView.tsx` & `src/pages/Widget.tsx`):
  - Componente de overlay con chasis broadcast transparente, corchetes esquineros de esports, resplandor ambiental reactivo y medidor LIVE de giro.
  - Integración en `Widget.tsx` con manejo de eventos `ROULETTE_SPIN` y `ROULETTE_TTS_CUE`.
  - Soporte de activación directa por chat con comandos `!ruleta`, `!spin` y `!wheel` en `src/hooks/useTwitchChat.ts`.
- [x] 29.4: Mesa de Control del Studio (`src/pages/RouletteStudio.tsx`):
  - Renderizado directo del `RouletteOverlayView` en el monitor 16:9 de simulación.
  - Tarjeta de Locutor TTS con indicador de voz activa del sistema, toggles de inicio y finalización, y botones de prueba directa.
- [x] 29.5: Quality Gates y Suite de Pruebas:
  - 22 pruebas unitarias en `tests/roulette.test.ts`. Total: 12 suites de prueba y 116/116 tests pasando con 0 errores.
  - Verificación de tipos `tsc --noEmit` limpia y empaquetado Vite completado con éxito en 6.5s.

## Phase 30: Corrección y Estabilización Cinemática del Eje de Rotación de la Ruleta (Zero Wobble)
- [x] 30.1: Eliminación del desvío excéntrico por CSS `transform-box` (`src/components/roulette/RouletteWheel.tsx`):
  - Diagnóstico: en Chromium/OBS Studio CEF, `transformOrigin: '220px 220px'` en elementos SVG `<g>` se calcula respecto al bounding box (`fill-box`) en vez del viewBox, desplazando el eje de rotación ~36px en diagonal y causando que la ruleta orbitara de forma irregular en lugar de girar sobre su eje.
  - Corrección: desacoplado GSAP del estilo CSS inline hacia un proxy numérico puro `{ angle: startRot }` que actualiza directamente el atributo estándar SVG `transform="rotate(rot, 220, 220)"`.
  - Garantía matemática: el centro de rotación queda bloqueado en coordenadas absolutas SVG `(220, 220)`, coincidiendo exactamente con la corona central turbine-hub con 0 píxeles de vibración o alabeo.
- [x] 30.2: Unificación mecánica y pivote de la aguja indicadora flipper (`src/components/roulette/RouletteWheel.tsx`):
  - Empaquetada la hoja de la aguja, el bisel 3D luminoso y la sombra proyectada dentro de un único grupo `<g ref={pointerRef}>`.
  - Eje de rotación del flipper anclado con precisión en su perno superior cromado `(220, 22)`.
  - Cinemática de flexión elástica GSAP con rebote orgánico (`elastic.out(2.0, 0.25)`) que oscila al unísono con cada clavija.
- [x] 30.3: Onda expansiva (Shockwave) y micro-retroceso físico (`src/components/roulette/RouletteWheel.tsx`):
  - Animación del radio `attr: { r: 42 }` y opacidad sin depender de transformOrigin en la onda expansiva.
  - Micro-retroceso físico de inercia al clavar el perno ganador ejecutado suavemente sobre el eje `(220, 220)`.
- [x] 30.4: Quality Gates y Verificación:
  - 116/116 pruebas unitarias pasando en Vitest (12/12 suites).
  - `tsc --noEmit` completado con 0 errores de tipado.
  - Build de producción Vite verificado en 5.91s.

## Phase 31: Sistema Unificado de Sincronización y Recarga Rápida para OBS Studio (Top-Bar 1-Click Sync)
- [x] 31.1: Botón Superior de Acción Primaria «Actualizar OBS» (`src/components/SuiteNav.tsx`):
  - Integrado en la barra superior persistente de navegación junto al menú de Widgets OBS.
  - Diseñado con estética de hardware Cabina Broadcast, halo cian, animación rotativa de progreso y tally LED de confirmación.
  - Triple acción al pulsar: emisión de evento `FORCE_RELOAD` y `SETTINGS_UPDATE` por `BroadcastChannel`, llamada HTTP al endpoint de recarga remota del backend (`POST /api/obs/reload` / `POST /api/version`), y copia automática al portapapeles del enlace actualizado con todos los parámetros codificados.
  - Feedback visual táctil (Emil Kowalski delight): transición de estado Idle (`Actualizar OBS`) → Sincronizando (`Enviando...`) → Completado (`¡OBS Actualizado!` en esmeralda con checkmark y HUD flotante).
- [x] 31.2: Enlaces Parametrizados Completos y Menú Enriquecido de Widgets OBS (`src/utils/widgetUrl.ts` & `src/components/SuiteNav.tsx`):
  - Creación de `buildSuiteWidgetUrl` para codificar de forma exhaustiva canal, voz de personaje (Diana, Jarvis, Teemo, Ahri, Luz), volumen, velocidad, estilo y acento para todas las herramientas (TTS, Ruleta, Alertas, Metas, Batallas, Todo-en-Uno).
  - Tarjeta de Sincronización en Vivo de 1-clic dentro del dropdown `Widgets OBS` para emitir actualizaciones directas.
- [x] 31.3: Endpoints de Recarga Remota y Polling Acelerado (`server/index.ts`, `api/version.ts`, `src/pages/Widget.tsx`):
  - Nuevos endpoints `POST /api/obs/reload` y `POST /api/version` que actualizan la versión dinámica del servidor.
  - En `Widget.tsx`, el observador de despliegue y recarga ahora responde inmediatamente ante recargas manuales pedidas por el streamer (`manual-reload`) y el intervalo de sondeo se aceleró a 7 segundos.
- [x] 31.4: Quality Gates y Suite de Pruebas:
  - Nueva suite `tests/widgetUrl.test.ts` con 7 pruebas unitarias.
  - Total del proyecto: 13 suites pasadas y 123/123 tests pasando en Vitest (100%).
  - `tsc --noEmit` completado con 0 errores de compilación.
  - Build de producción Vite completado exitosamente en 6.70s.

## Phase 32: Optimización Cinemática del Botón y Aviso HUD con GSAP, Emil Kowalski e Impeccable
- [x] 32.1: Micro-Interacciones Físicas del Botón de Actualización (`src/components/SuiteNav.tsx`):
  - Refinement táctil con respuesta a la presión `:active:scale-[0.96]` y `:active:translate-y-[0.5px]`.
  - Micro-recoil elástico con GSAP (`gsap.fromTo(syncBtnRef.current, { scale: 0.94 }, { scale: 1, duration: 0.35, ease: 'back.out(2.2)' })`) al completarse la sincronización.
  - Chasis broadcast con esquinas angulares de micro-hardware, bisel specular con `inset 0 1px 0 rgba(255,255,255,0.18)` y halo pulsante.
  - Síntesis de sonido de confirmación física cristalina (`playAlertAudio('synth-bell', 0.45)`) vía Web Audio API nativo con 0ms de latencia.
- [x] 32.2: Aviso Flotante HUD Cinemático con GSAP (`src/components/ObsSyncNotice.tsx`):
  - Componente dedicado con animación física de entrada: `y: -32 -> 0`, `scale: 0.92 -> 1`, `filter: blur(6px) -> 0px` con curva elástica `back.out(1.5)`.
  - Barra de progreso temporal que se consume proporcionalmente (`width: 100% -> 0%`) a lo largo del tiempo de auto-descarte (4.2s).
  - Faro beacon esmeralda pulsante concéntrico (`scale: 1.8`, `opacity: 0`).
  - Salida acelerada con micro-blur (`power2.in`, 220ms) tanto en auto-cierre como en descarte manual con botón `✕`.
  - Botón interactivo secundario para volver a copiar el enlace al instante si es necesario.
- [x] 32.3: Quality Gates y Verificación:
  - 123/123 pruebas unitarias pasando en Vitest (13 suites).
  - `tsc --noEmit` sin errores de TypeScript.
  - Build de producción Vite verificado en 6.42s.

## Phase 33: Comandos de Moderación para Encuestas, Preaviso por Voz y Votación Simple con Tiempos
- [x] 33.1: Parser de Comandos de Chat para Moderadores y Streamer (`src/utils/pollCommands.ts`):
  - Soporte completo de comandos `!poll`, `!encuesta`, `!batalla`, `!versus` accesibles para moderadores y broadcaster.
  - Sintaxis con comillas: `!poll "Título" "Opción A" "Opción B" [tiempo]`.
  - Sintaxis con pipes: `!poll Título | Opción A | Opción B | [tiempo]`.
  - Sintaxis con vs: `!poll Gatos vs Perros [tiempo]`.
  - Carga rápida de plantillas: `!poll preset gamer [tiempo]`, `!encuesta preset castigos`, etc.
  - Inicio rápido con tiempo: `!poll [tiempo]` (ej. `!poll 45` activa la encuesta por 45 seg) y detención inmediata: `!poll stop` / `!poll cancel`.
  - Validación y acotación segura de tiempos entre 10 y 600 segundos (default 60s).
- [x] 33.2: Sistema de Votación Ultra Simple y Eficiente (`src/types/polls.ts` & `src/hooks/useTwitchChat.ts`):
  - Reconocimiento de votos directos por un solo carácter: `1`, `2`, `a`, `b`.
  - Reconocimiento de ráfagas y repeticiones de chat: `111`, `222`, `aaa`, `bbb`.
  - Soporte de sintaxis abreviada y explícita: `!1`, `!2`, `!a`, `!b`, `#1`, `#2`, `!voto 1`, `!voto 2`, `voto 1`, `voto 2`.
  - Deduplicación por usuario y control de cambio de voto respetando la configuración del canal.
- [x] 33.3: Preaviso Sonoro y Locución TTS con Voz Oficial de Fish Audio (`src/utils/pollsAudio.ts`):
  - Chime broadcast brillante de triple armónico en Web Audio API (E5 -> A5 -> C#6) al activarse la encuesta.
  - Locución TTS estructurada con etiquetas emocionales `[emocionado]`:
    `"[emocionado] ¡Atención chat! El moderador {nombre} ha iniciado una votación: {título}. Para votar por {opción A}, escribe 1 en el chat. Para votar por {opción B}, escribe 2. ¡Tienen {tiempo} segundos para votar!"`
  - Sintetizado mediante `/api/tts` con la voz de personaje activa configurada (Diana, Jarvis, Teemo, Ahri, Luz o ID propio).
  - Alerta de cuenta regresiva en los últimos 10 segundos y locución triunfal con fanfare al finalizar.
- [x] 33.4: Ciclo de Vida y Temporizador Autónomo en OBS Overlay (`src/pages/Widget.tsx` & `src/hooks/usePollsSettings.ts`):
  - Gestión autónoma del temporizador y conteo de votos en el overlay de OBS (`Widget.tsx`), funcionando tanto si la página de control está abierta como si OBS corre de forma independiente.
  - Sincronización bidireccional inmediata vía `BroadcastChannel` con `POLL_START`, `POLL_STOP`, `POLL_VOTE` y `POLL_STATE_UPDATE`.
  - Toast HUD de moderación en pantalla notificando qué moderador inició o canceló la votación.
  - Revelación dramática del ganador con retención de 10 segundos antes del desvanecimiento cinemático con GSAP.
- [x] 33.5: Guía Visual y Tester de Preaviso en el Studio (`src/pages/PollsStudio.tsx`):
  - Tarjeta de referencia de comandos para moderadores y streamer con ejemplos claros de sintaxis y reglas de voto.
  - Botón de prueba en el monitor de emociones TTS para escuchar la locución exacta de preaviso de moderador.
- [x] 33.6: Quality Gates y Suite de Pruebas:
  - 12 nuevas pruebas unitarias en `tests/polls.test.ts`. Total: 135/135 tests pasando en Vitest (13 suites al 100%).
  - `tsc --noEmit` completado con 0 errores de TypeScript.
  - Empaquetado de producción Vite verificado en 7.14s sin errores.

## Phase 34: Temas Cinemáticos de Batallas, Sincronización Global del Diseño & Micro-Interacciones
- [x] 34.1: 5 Temas Visuales Cinemáticos para Overlays en OBS Studio (`src/components/polls/BattleBarView.tsx` & `src/types/polls.ts`):
  - **Cabina Broadcast (`cabina`)**: Estética de rack de máster de transmisión con chasis gunmetal, tornillos biselados, indicador LED `AL AIRE` parpadeante, vúmetros estéreo animados reactivos con GSAP y telemetría analógica.
  - **Neon Synthwave (`neon`)**: Chasis obsidiana profundo `#030308`, textura CRT de scanlines horizontales, tubos de neón láser cian (`#00f0ff`) vs magenta ácido (`#ff007f`) con resplandor difuso drop-shadow y anillo estroboscópico VS con destellos.
  - **Arena Esports (`esports`)**: Fondo de fibra de carbono con biseles diagonales a 45°, cortes angulares de torneo, corona dorada de victoria con chispas animadas y badge VS 3D con retroceso elástico (`elastic.out(1.4, 0.25)`).
  - **Tactical Cyber HUD (`cyber`)**: Cristal holográfico con malla hexagonal, retículas de apuntado `[ + ]` en las esquinas, cabecera de datos monospace (`SYSTEM_FEED // LIVE_DECISION_PROTOCOL`), barras segmentadas digitales (10 bloques dinámicos por bando) y rombo táctico VS.
  - **Minimal Frosted Glass (`minimal`)**: Píldora flotante con desenfoque de fondo ultra limpio (`backdrop-blur-xl`), borde vítreo `border-white/10`, tipografía suiza sobria y gradiente líquido de terciopelo.
- [x] 34.2: Selector Visual de Temas y Personalización en Polls Studio (`src/pages/PollsStudio.tsx`):
  - Cuadrícula de 5 temas con miniaturas, badges de color de acento y previsualización en vivo en el monitor 16:9 de OBS.
  - Paleta de muestras de color personalizadas para Opción 1 y Opción 2 con retroalimentación táctil `:active:scale-[0.9]`.
  - Selector de duración rápida en píldoras (15s, 30s, 45s, 60s, 90s, 120s).
- [x] 34.3: Sincronización del Diseño Global y Chasis Broadcast (`src/index.css`, `PollsStudio.tsx`, `Catalog.tsx`):
  - Estandarización de tokens de diseño (`.cab`, `.cab-mod`, `.cab-field`, `.cab-label`, `.cab-inp`, `.cab-btn`, `.cab-btn2`, `.cab-seg`, `--cb-line`, `--cb-panel`, `--cb-surface`, `--cb-fg`, `--cb-mut`).
  - Armonización de encabezados en todos los módulos (`MÓDULO X · CATEGORÍA`, títulos con `cab-caps`, acciones de copiado y apertura con `:active:scale-[0.97]`).
  - Catálogo central (`Catalog.tsx`): Módulo 7 actualizado de prototipo a `DISPONIBLE`, con botón `Probar` para disparar simulación al instante hacia OBS y el bus local.
- [x] 34.4: Integración en OBS Browser Source mediante URL Parametrizada (`src/utils/widgetUrl.ts` & `src/pages/Widget.tsx`):
  - `buildSuiteWidgetUrl` codifica `&theme=` según el tema activo seleccionado.
  - `Widget.tsx` lee el parámetro de URL para aplicar el tema de forma autónoma en la fuente de navegador de OBS.
- [x] 34.5: Quality Gates y Suite de Pruebas:
  - Pruebas unitarias de definición y persistencia de temas visuales en `tests/polls.test.ts`. Total: 138/138 pruebas unitarias pasando en Vitest (13 suites al 100%).
  - `tsc --noEmit` completado con 0 errores de TypeScript.
  - Compilación de producción Vite verificada exitosamente en 5.76s.


