# Sabha (सभा) — Known Issues & Technical Debt
**File:** `docs/KNOWN_ISSUES.md`

This document serves as the central ledger for all known bugs, technical debt, dead code, and unresolved typing issues across the codebase. 
As per the rules outlined in `AGENTS.md`, developers and AI agents should actively work to burn down this list during feature development.

---

## 1. 🗑️ Dead Code & Unused Files

The following files and dependencies are tracked:

- **Unused Files:**
  - ~~`components/FirebaseSetupModal.tsx`~~ *(Resolved: Deleted unreferenced modal).*
- **Unused NPM Dependencies:**
  - `@livekit/components-react` and `@livekit/components-styles` are installed but never imported, as the application relies purely on the native `livekit-client` SDK instead.
- **Unused Functions & Exports (in `lib/firebase.ts`):**
  - `getActiveFirebaseConfig`
  - `saveLocalFirebaseConfig`
  - `clearLocalFirebaseConfig`
  - `app`
  - `googleProvider`
  - `FirebaseConfigOptions` (Type interface)

---

## 2. 🐛 Bugs & React Anti-Patterns

- **Cascading Render (Performance Bug):** 
  - **Location:** `lib/authContext.tsx`
  - **Status:** *(Resolved: Initialized `isFirebaseReady` via lazy state initializer `useState(() => isFirebaseConfigured())`, eliminating synchronous secondary render cycle).*
- **Improper Variable Declarations:** 
  - **Location:** `lib/roomService.ts`
  - **Status:** *(Resolved: Changed `let waitingMap` to `const waitingMap`).*
- **Gemini API 429 Rate Limit (Quota Exceeded on 20 RPD Preview Models):**
  - **Location:** `app/api/meeting/summarize-and-email/route.ts`, `app/api/translate/route.ts`
  - **Details:** `gemini-3-*` preview models enforce a strict 20 requests/day quota on the free tier, and live translation calls were hitting Gemini repeatedly during calls.
  - **Status:** *(Resolved: Completely removed Gemini from `/api/translate` in favor of $0 free public translation gateway with memory caching, ensuring 0 API calls during live calls. Upgraded `summarize-and-email` to standard high-quota models `gemini-2.5-flash`, `gemini-2.5-flash-lite`, `gemini-2.0-flash`, and `gemini-1.5-flash` with 1,500 RPD, and added an intelligent structured speaker-dialogue summary fallback guaranteeing executive notes are always dispatched to emails even if Google API is offline).*
- **Universal Multi-Language & Target Language Subtitle Translation:**
  - **Location:** `lib/translation.ts`, `components/meeting/MeetingControls.tsx`, `components/meeting/MeetingRoom.tsx`, `app/api/translate/route.ts`
  - **Details:** 1) In non-dual modes (e.g. 'English Only', 'Marathi', etc.), captions previously included Hindi secondary text due to returning original text as secondary. 2) Source language was previously hardcoded to Hindi/English, causing non-Devanagari spoken languages (Telugu, Tamil, Marathi, German, French, etc.) to not convert properly. 3) Stale closures in `MeetingRoom` `init()` prevented Chrome from updating caption preferences and delayed incoming captions behind async translation promises.
  - **Status:** *(Resolved: 1) Eliminated Hindi secondary text from all non-dual languages (English Only shows pure English, Hindi Only shows pure Hindi, regional/global show pure target language; Dual displays stacked). 2) Integrated universal `autodetect` across client and server routes to automatically convert ANY spoken language into the user's chosen target language. 3) Implemented `captionLanguageRef` and `handleAppendTranscriptItemRef` with instant 0ms unblocked rendering so Chrome and Safari receive and display captions with zero delay).*
- **Brave Browser Privacy Blocking of Google Web Speech API:**
  - **Location:** `components/meeting/MeetingRoom.tsx`, `lib/transcriptionService.ts`
  - **Details:** Modern Brave desktop releases removed the Google Speech toggle completely from `brave://settings/system` for strict privacy, and browser security sandboxes block webpages from navigating to internal `brave://` protocols. This caused confusion when an earlier banner told users to visit `brave://settings/system`.
  - **Status:** *(Resolved: Updated Brave notice to accurately inform users that Brave disables speech-to-text for privacy while full 2-way WebRTC audio/video and viewing incoming live subtitles works 100%. Replaced the unworkable internal link with a 1-click 'Copy Link for Chrome/Edge' button and a 'Got it' dismiss button).*

---

## 3. 🧹 Unused Imports

- **Icons:** 
  - ~~`Users` imported but unused in `components/meeting/WaitingRoom.tsx`~~ *(Resolved).*
  - ~~`Bell` imported but unused in `components/meeting/WaitingRoomBanner.tsx`~~ *(Resolved).*
- **LiveKit SDK:** 
  - ~~`LocalTrackPublication` and `LocalParticipant` in `lib/livekitService.ts`~~ *(Resolved).*
- **Firebase SDK:** 
  - ~~`serverTimestamp`, `orderBy`, `getDocs`, and `writeBatch` in `lib/webrtc.ts`~~ *(Resolved).*

---

## 4. ⚠️ TypeScript Strictness

- **Rampant `any` Types:** 
  - There are currently instances of `any` types being used across `lib/webrtc.ts`, `lib/types.ts`, `lib/audio.ts`, and various UI components. 
  - **Impact:** Breaks strict type safety; gradually migrating to typed DTOs and interfaces (`TranscriptItem`, `SignalData`, `WhiteboardDrawEvent`).

---

## 5. 🚨 Memory Leaks

- **Uncleared Timers in `useEffect`:**
  - **Location:** `components/meeting/WaitingRoomBanner.tsx`
  - **Status:** *(Resolved: Stored timer reference and returned explicit `() => clearTimeout(timer)` and `audioCtx.close()` cleanup functions).*

---

## 6. 🐢 Performance Bottlenecks & Missing Optimizations

- **Missing `useCallback` Memoization in State Orchestrators:**
  - **Location:** `components/meeting/MeetingRoom.tsx`
  - **Details:** Massive handler functions (`handleToggleScreenShare`, `handleMuteParticipant`, etc.) are passed to heavy child components like `<VideoGrid>` and `<ChatPanel>` but are not wrapped in `useCallback`. This causes the entire heavy video DOM tree to re-render whenever trivial state changes occur (like a chat message arriving).
- **Missing Component Memoization:**
  - **Location:** `<VideoGrid>`, `<VideoTile>`, `<ChatPanel>`, `<MeetingControls>`
  - **Details:** These heavy components are not wrapped in `React.memo()`. Combined with the missing `useCallback` in the parent, this leads to severe CPU spikes, layout thrashing, and battery drain during large calls.
