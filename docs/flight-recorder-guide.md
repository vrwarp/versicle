# TTS Flight Recorder: Snapshot Interpretation Guide

## What Is a Flight Recorder Snapshot?

The TTS Flight Recorder is a diagnostic tool built into Versicle's audio playback system. It continuously records a timeline of internal events — every play, pause, queue change, and chapter transition — into a ring buffer. When something goes wrong (or you press the **Take Snapshot** button in Settings → Diagnostics), it freezes the buffer into a JSON file.

A snapshot captures the **last ~2000 events** (roughly 30–60 minutes of playback) leading up to the moment it was taken. Think of it as a black box recording from an airplane — you don't need it until something goes wrong, but when it does, it tells you exactly what happened.

---

## Snapshot File Structure

A snapshot JSON file contains:

```json
[
  { "seq": 0,    "ts": 1234.5, "wall": 1745875800000, "src": "APS", "ev": "play",       "d": { "status": "stopped" } },
  { "seq": 1,    "ts": 1234.8, "wall": 1745875800000, "src": "APS", "ev": "status",     "d": { "from": "stopped", "to": "loading" } },
  { "seq": 2,    "ts": 1235.1, "wall": 1745875800001, "src": "CAP", "ev": "play.flush",  "d": { "uttId": 1, "textLen": 42 } },
  ...
]
```

Each line is one **event**. Events are always in chronological order.

---

## Reading an Event

Every event has these fields:

| Field | What It Means |
|-------|---------------|
| `seq` | Sequence number. Events are numbered 0, 1, 2, ... in order. Gaps mean older events were evicted from the ring buffer. |
| `ts` | High-resolution timestamp in milliseconds (from `performance.now()`). Use this for precise timing between events — e.g., if two events are 0.3ms apart, something happened nearly instantly. |
| `ts` differences | The **gap between `ts` values** is the most important thing. A gap of 800–2000ms between a `play.flush` and `onEnd` means the TTS engine spoke for ~1–2 seconds (normal). A gap of 0.1ms means something fired instantly (suspicious). |
| `wall` | Wall-clock time (Unix timestamp in ms). Use `new Date(wall)` to get a human-readable time. Useful for correlating with "I pressed play at 8:42 PM." |
| `src` | Which component emitted the event (see **Source Codes** below). |
| `ev` | The event type (see **Event Reference** below). |
| `d` | Optional data payload with key-value pairs. Contents vary by event type. |

### Source Codes

| Code | Component | Role |
|------|-----------|------|
| `APS` | **AudioPlayerService** | The main orchestrator. Manages play/pause/stop, queue traversal, chapter transitions. |
| `PSM` | **PlaybackStateManager** | Holds the queue array and current index. Fires when the queue is replaced or the index moves. |
| `CAP` | **CapacitorTTSProvider** | The Android TTS engine wrapper. Fires when native speech starts, ends, or is preloaded. |
| `TSQ` | **TaskSequencer** | Ensures async operations run one at a time. Shows task queuing and execution order. |
| `TTS` | **useTTS Hook** | The React hook that bridges the visual reader UI to the audio engine. |
| `PLT` | **PlatformIntegration** | Media session (lock screen controls) and background audio. |

---

## Event Reference

### Normal Playback Cycle

A single sentence being spoken produces this pattern:

```
APS  playInternal     → "I'm about to speak this sentence"
CAP  play.flush       → "I told Android TTS to speak it"
CAP  onEnd            → "Android TTS finished speaking it"
APS  playNext         → "Moving to the next sentence"
PSM  next             → "Queue index advanced from N to N+1"
APS  playInternal     → "Speaking the next sentence..."
CAP  play.handoff     → "Smart Handoff: Android was already playing this one"
...
```

### Key Events Explained

#### `APS:playInternal` — A sentence is about to be spoken

```json
{ "src": "APS", "ev": "playInternal", "d": { "index": 42, "cfi": "epubcfi(/6/14!...)", "textPreview": "He walked slowly toward" } }
```

- `index`: Position in the queue (0-based). If the queue has 200 items and index is 42, you're 21% through the chapter.
- `textPreview`: First ~80 characters of the sentence. Useful for confirming what the user was hearing.
- `cfi`: The EPUB location pointer. Can be used to find the exact position in the book.

#### `APS:playNext` — Transitioning to the next sentence

```json
{ "src": "APS", "ev": "playNext", "d": { "index": 42, "hasNext": true, "queueLen": 200, "skippedCount": 0 } }
```

- `index`: The sentence that just FINISHED playing.
- `hasNext`: Whether there's another sentence after this one.
- `queueLen`: Total sentences in the current chapter's queue.
- `skippedCount`: How many sentences were skipped (masked by content filter) to find the next one.

**🚨 If `hasNext` is `false`, the engine will advance to the next chapter.** This is the event to look for when diagnosing premature chapter advances.

#### `APS:playNext.advance` — Chapter advance triggered

```json
{ "src": "APS", "ev": "playNext.advance", "d": { "fromSection": 5, "toSection": 6 } }
```

**This is the "smoking gun" event.** It means the engine decided to move to the next chapter. Look at the preceding `playNext` event to see WHY — was `hasNext` false? Was the `index` near the end of the queue, or in the middle?

#### `PSM:setQueue` — The queue was replaced

```json
{ "src": "PSM", "ev": "setQueue", "d": { "len": 200, "startIndex": 0, "sectionIndex": 5, "prevLen": 180, "prevIndex": 42 } }
```

- `len` / `startIndex`: The NEW queue's size and starting position.
- `prevLen` / `prevIndex`: The OLD queue's size and where the cursor was.

**🚨 If you see this while playback is active, the queue was swapped mid-playback.** Check if `startIndex` is 0 (reset to beginning) and whether `prevIndex` was non-zero (was in the middle). This is a major clue for the chapter-skip bug.

#### `CAP:play.flush` — Standard TTS play (Android)

```json
{ "src": "CAP", "ev": "play.flush", "d": { "uttId": 7, "textLen": 45 } }
```

The Android TTS engine was told to speak a sentence from scratch (flushing any previous audio). `uttId` is the utterance ID — it increments with each new play call. If you see the same `uttId` twice, something went wrong.

#### `CAP:play.handoff` — Smart Handoff (gapless playback)

```json
{ "src": "CAP", "ev": "play.handoff", "d": { "uttId": 8, "textLen": 12, "promiseSettled": false } }
```

The engine detected that this sentence was already preloaded into Android's native TTS buffer. Instead of restarting, it "adopted" the running playback.

- `promiseSettled`: **Critical field.** If `true`, the native TTS already finished speaking this sentence before the JS engine got to it. This can cause timing issues (the `onEnd` fires immediately instead of when speech completes).

#### `CAP:preload` — Next sentence queued into native buffer

```json
{ "src": "CAP", "ev": "preload", "d": { "uttId": 8, "textLen": 30 } }
```

After speaking a sentence, the engine pre-queues the next one into Android's native TTS buffer for gapless playback.

#### `CAP:onEnd` — Native TTS finished speaking

```json
{ "src": "CAP", "ev": "onEnd", "d": { "uttId": 7 } }
```

Android finished speaking the sentence. This triggers `playNext` to advance to the next sentence.

#### `APS:status` — Status changed

```json
{ "src": "APS", "ev": "status", "d": { "from": "playing", "to": "stopped" } }
```

Valid statuses: `stopped`, `loading`, `playing`, `paused`, `completed`.

#### `APS:restoreQueue` — Queue restored from cache on app launch

```json
{ "src": "APS", "ev": "restoreQueue", "d": { "queueLen": 200, "currentIndex": 100, "sectionIndex": 5 } }
```

The engine loaded a saved queue from the database. Check if `sectionIndex` is `-1` — that means the section tracking was lost, which can cause guard clauses to fail.

#### `APS:loadSectionById.guard` — Guard clause decision

```json
{ "src": "APS", "ev": "loadSectionById.guard", "d": { "reason": "bail", "currentSecIdx": 5, "targetIdx": 5 } }
```

The UI asked to load a section, and the engine decided whether to proceed or bail out.

- `reason: "bail"`: The engine correctly skipped the reload (section already loaded).
- `reason: "proceed"`: The engine proceeded to reload the section. If this happens during playback, it will wipe the queue.

**🚨 If `currentSecIdx` is `-1`, the guard always fails (proceeds), which can cause unintended queue replacements.**

#### `TTS:sync` — React UI triggered a sync

```json
{ "src": "TTS", "ev": "sync", "d": { "bookId": "abc123", "sectionId": "ch5", "isPlaying": true } }
```

The `useTTS` React hook detected a section change in the visual reader and considered syncing the audio engine.

- If `isPlaying` is `true`, the sync was blocked (safe).
- If followed by `sync.fired`, the sync proceeded and called `loadSectionBySectionId`.

---

## Common Diagnostic Patterns

### Pattern 1: Premature Chapter Advance

**Symptom:** Audio jumps to the next chapter unexpectedly.

**What to look for:**

1. Find the `playNext.advance` event (search for `"ev":"playNext.advance"`).
2. Look at the event immediately before it — it should be a `playNext` with `hasNext: false`.
3. Check the `index` and `queueLen` values:
   - If `index` is near `queueLen` (e.g., 198/200) → the queue was genuinely exhausted. The issue might be with the queue being too short (content filter removed items).
   - If `index` is far from `queueLen` (e.g., 42/200) → something caused `hasNext` to return false despite items remaining. This likely means all remaining items are marked as skipped.
   - If `queueLen` is unexpectedly small → the queue was replaced. Look backwards for a `PSM:setQueue` event.

4. If you find a `PSM:setQueue` between the last `playInternal` and the `playNext.advance`, the queue was swapped mid-playback. Check:
   - Was `startIndex` reset to 0?
   - What was `prevIndex`?
   - Look further back to see what triggered the `setQueue` — was it a `loadSectionById.guard` with `reason: "proceed"`?

### Pattern 2: Queue Replacement During Playback

**Symptom:** Audio restarts from the beginning of the chapter, or plays the wrong content.

**What to look for:**

1. Find `PSM:setQueue` events.
2. Check if the preceding events show `APS:status` with `to: "playing"` — this means the queue was replaced while audio was active.
3. Look for the trigger: trace backwards from `setQueue` to find either:
   - `APS:loadSectionById.guard` with `reason: "proceed"` → the guard failed to protect the queue
   - `APS:restoreQueue` → a queue restore happened at an unexpected time

### Pattern 3: Double `onEnd` (Smart Handoff Race)

**Symptom:** A sentence is skipped or the engine advances two sentences at once.

**What to look for:**

1. Find consecutive `CAP:onEnd` events and check the `ts` gap between them.
2. If two `onEnd` events are less than 50ms apart, the Smart Handoff adopted an already-resolved promise.
3. Check if the `play.handoff` event has `promiseSettled: true`.

### Pattern 4: Silence / Playback Stops

**Symptom:** Audio stops playing without reaching the end of the chapter.

**What to look for:**

1. Find the last `APS:status` event — what was the transition?
2. If `to: "stopped"` without a preceding `playNext.advance`, something explicitly stopped playback.
3. Look for `APS:error` events.
4. Check for `CAP:stop` — was the provider stopped externally?

---

## Quick Reference: Reading a Timeline

Here's a healthy playback sequence for one sentence at index 42:

```
seq  ts      src  ev              key data
───  ──────  ───  ──────────────  ─────────────────────────────
100  5000.0  APS  playInternal    index=42, textPreview="The sun set over..."
101  5001.2  CAP  play.flush      uttId=15, textLen=38
102  5001.5  CAP  preload         uttId=15, textLen=22
103  6842.3  CAP  onEnd           uttId=15                      ← 1841ms of speech
104  6842.5  APS  playNext        index=42, hasNext=true, queueLen=200
105  6842.6  PSM  next            from=42, to=43
106  6842.8  APS  playInternal    index=43, textPreview="She turned..."
107  6843.0  CAP  play.handoff    uttId=16, promiseSettled=false ← gapless!
108  6843.2  CAP  preload         uttId=16, textLen=45
```

**Key things to verify:**
- The gap between `play.flush` (seq 101) and `onEnd` (seq 103) is ~1841ms — that's how long the sentence took to speak. Anything under 50ms is suspicious.
- `hasNext` is `true` at seq 104 — the engine correctly found the next sentence.
- `play.handoff` at seq 107 has `promiseSettled: false` — the preloaded audio was still playing when adopted (correct behavior).
- `preload` appears after each `play` — the next sentence is being pre-queued.

---

## Using `jq` for Analysis

If you have `jq` installed, these commands help analyze exported snapshots:

```bash
# Pretty-print with human-readable timestamps
cat snapshot.json | jq '[.[] | . + {time: (.wall/1000 | strftime("%H:%M:%S"))}]'

# Find all chapter advances and the 10 events before each
cat snapshot.json | jq '
  to_entries
  | map(select(.value.ev == "playNext.advance"))
  | .[].key as $k
  | [to_entries[] | select(.key >= ($k - 10) and .key <= $k)]
  | .[].value
' snapshot.json

# Find all setQueue events (queue replacements)
cat snapshot.json | jq '[.[] | select(.ev == "setQueue")]'

# Find rapid-fire onEnd events (< 50ms apart)
cat snapshot.json | jq '
  [.[] | select(.ev == "onEnd")]
  | [range(1; length) as $i | {gap: (.[$i].ts - .[$i-1].ts), a: .[$i-1], b: .[$i]}]
  | [.[] | select(.gap < 50)]
'

# Show the "story" — just the high-level events, no noise
cat snapshot.json | jq '[.[] | select(.ev | test("playInternal|playNext|setQueue|status|advance|restoreQueue|loadSection|guard|snapshot"))]'
```

---

## Sharing a Snapshot

When reporting a bug, include:
1. The snapshot JSON file (from Settings → Diagnostics → Share)
2. What you were doing when the problem occurred
3. What you expected vs. what happened
4. The approximate time (check the `wall` field of the snapshot marker event — search for `"ev":"snapshot"`)
