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
- **Gemini API 404 Model Deprecation:**
  - **Location:** `app/api/meeting/summarize-and-email/route.ts`
  - **Status:** *(Resolved: Upgraded model cascade to `gemini-3.5-flash` and `gemini-3.8-flash`, removing deprecated `gemini-2.5-*` references).*
- **Attendee Email Delivery Failure:**
  - **Location:** `lib/livekitService.ts`, `app/api/livekit-token/route.ts`, `app/api/meeting/summarize-and-email/route.ts`
  - **Status:** *(Resolved: Participant email now propagated through LiveKit token metadata, parsed in `syncParticipants()`, registered in Firestore `/rooms/{roomId}/participants`, and dispatched individually to each attendee).*
- **Truncated Concluding Meeting Speech:**
  - **Location:** `lib/transcriptionService.ts`, `components/meeting/MeetingRoom.tsx`
  - **Status:** *(Resolved: Added `flushInterim()` buffer mechanism ensuring words spoken right before call end are converted to final transcript items).*
- **Brave Browser Web Speech API & MediaRecorder NotSupportedError:**
  - **Location:** `lib/transcriptionService.ts`, `components/meeting/MeetingRoom.tsx`
  - **Details:** Brave Browser intentionally blocks Google's Web Speech API server endpoints, causing `recognition.onerror({ error: 'network' })`. The previous audio fallback attempted `MediaRecorder` chunking which triggered `NotSupportedError: Failed to execute 'start' on 'MediaRecorder'` in Brave's sandbox and risked consuming heavy Gemini API tokens during live calls.
  - **Status:** *(Resolved: Enforced 100% free ($0) browser-native Web Speech API. Deprecated continuous background audio chunking to protect API tokens ($0 live speech guarantee). Added graceful Brave Shields detection, zero console errors, real-time cross-peer transcript broadcasting to Brave attendees, and a dismissable guidance banner directing users to enable speech recognition in `brave://settings/system`).*
- **Dynamic Video Tile Stretching & Camera Cropping:**
  - **Location:** `components/meeting/VideoGrid.tsx`, `components/meeting/VideoTile.tsx`
  - **Details:** Single-user and multi-user grid containers dynamically filled available viewport height without an aspect ratio lock, causing video tiles to stretch into square or vertical boxes and heavily zoom/crop webcam feeds.
  - **Status:** *(Resolved: Enforced standard 16:9 widescreen (`aspect-video`) constraint across all video containers, single-user centered view, speaker stage, PIP presentation, and multi-user gallery grids, guaranteeing Zoom-parity rectangular framing with zero camera distortion).*
- **Dual-Language Hindi + English Live Captions:**
  - **Location:** `lib/translation.ts`, `lib/transcriptionService.ts`, `components/meeting/MeetingRoom.tsx`, `components/meeting/MeetingControls.tsx`
  - **Status:** *(Resolved: Replaced single-language exclusive toggling with default Dual Mode (`हिन्दी + EN`). Shows both spoken speech and instant bilingual translations simultaneously without requiring users to switch back and forth).*

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
