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
  - **Location:** `lib/translation.ts`, `components/meeting/MeetingControls.tsx`, `components/meeting/MeetingRoom.tsx`
  - **Details:** Previously, users could only toggle single languages and could not force incoming multi-speaker dialogue to translate into a single chosen language.
  - **Status:** *(Resolved: Implemented personalized Target Language Subtitle Engine with interactive CC popover. Supports 'Hindi Only' (translates all speech to Hindi), 'English Only' (translates all speech to English), 'Dual' (stacked bilingual subtitles), 9 Indian regional languages (मराठी, বাংলা, தமிழ், తెలుగు, ગુજરાતી, ಕನ್ನಡ, ਪੰਜਾਬੀ, മലയാളം, اردو), and 6 global languages (Español, Français, Deutsch, 日本語, العربية, Русский) with 0ms memory caching and $0 token cost).*

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
