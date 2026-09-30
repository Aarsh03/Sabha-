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
