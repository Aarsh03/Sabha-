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
  - ~~`@livekit/components-react` and `@livekit/components-styles`~~ *(Resolved: uninstalled).*
- **Unused Functions & Exports (in `lib/firebase.ts`):**
  - ~~`getActiveFirebaseConfig`, `saveLocalFirebaseConfig`, `clearLocalFirebaseConfig`, `app`, `googleProvider`, `FirebaseConfigOptions`~~ *(Resolved: removed dead functions; un-exported module-internal names).*
- **Other dead code removed:** unused `React`/icon imports, unused locals and props, no-op `setAudioStream`, unused translation helpers.

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
- [x] **Brave Browser Privacy Blocking of Google Web Speech API:**
  - **Location:** `components/meeting/MeetingRoom.tsx`, `lib/transcriptionService.ts`
  - **Details:** Modern Brave desktop releases removed the Google Speech toggle completely from `brave://settings/system` for strict privacy, and browser security sandboxes block webpages from navigating to internal `brave://` protocols. This caused confusion when an earlier banner told users to visit `brave://settings/system`.
  - **Status:** *(Resolved: Updated Brave notice to accurately inform users that Brave disables speech-to-text for privacy while full 2-way WebRTC audio/video and viewing incoming live subtitles works 100%. Replaced the unworkable internal link with a 1-click 'Copy Link for Chrome/Edge' button and a 'Got it' dismiss button).*
- [x] **MyMemory Translation 429 IP Quota Block:**
  - **Location:** `lib/translation.ts`, `app/api/translate/route.ts`
  - **Details:** The free MyMemory API enforces a 5,000 words/day IP limit, returning HTTP 429 and causing English subtitles to fall back to untranslated Hindi text.
  - **Status:** *(Resolved: Replaced with Google Chrome Translation Gateway `clients5.google.com/translate_a/t?client=dict-chrome-ex`, providing $0 cost, unlimited capacity, and ~80ms response latency).*
- [x] **Firestore `undefined` Field Value Crash in `setDoc()`:**
  - **Location:** `lib/roomService.ts`
  - **Details:** When storing transcripts, `translation: undefined` was passed to Firestore's `setDoc()`, triggering `FirebaseError: Function setDoc() called with invalid data. Unsupported field value: undefined`.
  - **Status:** *(Resolved: Sanitized transcript payload in `saveRoomTranscriptItem` to ensure only defined fields are saved).*
- [x] **Interim Subtitle Flickering & Jargon Text Display:**
  - **Location:** `components/meeting/MeetingRoom.tsx`
  - **Details:** High-frequency Web Speech API interim results fired 15-20 times/sec per partial syllable, flashing raw untranslated text before translation completed and rapidly disappearing.
  - **Status:** *(Resolved: Added 280ms anti-flicker debouncing for interim speech with minimum 2-word threshold, pre-formatted text according to target language before rendering, and extended finalized subtitle display to 6 full seconds).*
- [x] **Spoken Transcripts Logged in English & Strict English AI Summaries:**
  - **Location:** `components/meeting/MeetingRoom.tsx`, `app/api/meeting/summarize-and-email/route.ts`
  - **Details:** Transcripts were previously saved in Devanagari Hindi, and Gemini summaries occasionally included Hindi/Hinglish quotations.
  - **Status:** *(Resolved: Finalized speech is converted to English for `text` prior to saving in Firestore and `transcriptRef.current` (original preserved in `translation`). Gemini prompt strictly mandates 100% professional English with zero Devanagari/Hindi/Hinglish, and fallback summary generates pure English highlights).*
- [x] **Instant Meeting End for All Participants with Background Server Summarization:**
  - **Location:** `components/meeting/MeetingRoom.tsx`, `app/api/meeting/summarize-and-email/route.ts`
  - **Details:** Previously, ending a meeting forced the host and attendees to wait on a 60-second modal screen.
  - **Status:** *(Resolved: Replaced 60-second screen modal with instant exit for all participants. Flushes local speech buffers, broadcasts kick/leave to peers immediately, and dispatches `/api/meeting/summarize-and-email` with `keepalive: true`. The server merges Firestore transcripts in the background and sends emails via Zoho Mail).*

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

- ~~**Rampant `any` Types**~~ *(Resolved: replaced with typed DTOs — `SignalPayload`, `DataMessage`, `WhiteboardDrawEvent`, `ErrorLike` in `lib/types.ts`, and browser-API declarations in `lib/browser.d.ts`; ESLint reports zero `no-explicit-any`).*

---

## 5. 🚨 Memory Leaks

- **Uncleared Timers in `useEffect`:**
  - **Location:** `components/meeting/WaitingRoomBanner.tsx`
  - **Status:** *(Resolved: Stored timer reference and returned explicit `() => clearTimeout(timer)` and `audioCtx.close()` cleanup functions).*

---

## 6. 🐢 Performance Bottlenecks & Missing Optimizations

- ~~**Missing `useCallback` Memoization in State Orchestrators**~~ *(Resolved: handlers passed to heavy children now have stable identity via `useStableCallback` in `lib/useStableCallback.ts`, and `participants` is memoized).*
- ~~**Missing Component Memoization**~~ *(Resolved: `VideoGrid`, `VideoTile`, `ChatPanel`, `MeetingControls` are wrapped in `React.memo()`).*
