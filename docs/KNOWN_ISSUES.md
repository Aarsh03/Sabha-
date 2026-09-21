# Sabha (सभा) — Known Issues & Technical Debt
**File:** `docs/KNOWN_ISSUES.md`

This document serves as the central ledger for all known bugs, technical debt, dead code, and unresolved typing issues across the codebase. 
As per the rules outlined in `AGENTS.md`, developers and AI agents should actively work to burn down this list during feature development.

---

## 1. 🗑️ Dead Code & Unused Files

The following files and dependencies are completely unreferenced and should be removed to reduce bloat:

- **Unused Files:**
  - `components/FirebaseSetupModal.tsx` is completely unreferenced in the UI.
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
  - **Location:** `lib/authContext.tsx` (Line 99)
  - **Details:** `setIsFirebaseReady(ready)` is being called synchronously directly inside a `useEffect` body. This triggers an immediate secondary render cycle that degrades performance and violates React hook best practices (`react-hooks/set-state-in-effect`).
- **Improper Variable Declarations:** 
  - **Location:** `lib/roomService.ts`
  - **Details:** `waitingMap` is declared with `let` but never reassigned. It should be changed to a `const`.

---

## 3. 🧹 Unused Imports

There are several leftover imports cluttering up files that should be cleaned:

- **Icons:** 
  - `Users` imported but unused in `components/meeting/WaitingRoom.tsx`.
  - `Bell` imported but unused in `components/meeting/WaitingRoomBanner.tsx`.
- **LiveKit SDK:** 
  - `LocalTrackPublication` and `LocalParticipant` in `lib/livekitService.ts`.
- **Firebase SDK:** 
  - `serverTimestamp`, `orderBy`, `getDocs`, and `writeBatch` in `lib/webrtc.ts`.

---

## 4. ⚠️ TypeScript Strictness

- **Rampant `any` Types:** 
  - There are currently 38 instances of `any` types being used across `lib/webrtc.ts`, `lib/types.ts`, `lib/audio.ts`, and various UI components. 
  - **Impact:** This severely breaks type safety and can hide runtime crashes. These need to be properly typed with interfaces and DTOs.
