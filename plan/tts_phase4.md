# TTS Phase 4: Advanced Sync & Polish

This phase focuses on refining the user experience, improving playback reliability, and adding visual feedback for the TTS system.

## 1. Refined Segmentation (Completed)
- [x] **Switch to `Intl.Segmenter`**: Replaced regex-based splitting in `src/lib/tts/TextSegmenter.ts`.
- [x] **Abbreviation Handling**: Added logic to merge common abbreviations (e.g., "Mr.", "Dr.") back into sentences.
- [x] **Language Support**: Configured segmenter to respect the book's language metadata.

## 2. Playlist UI
- [x] **Queue Component**: Create a visual list of the playback queue.
  - [x] Show current, past, and upcoming sentences.
  - [x] Highlight the active segment.
  - [x] Allow clicking a segment to skip to it.
- [x] **Integration**: Add the queue component to the Reader view (e.g., inside a drawer or popover).
- [ ] **Scroll Sync**: Ensure the queue automatically scrolls to keep the active segment visible.
- [x] **Empty State**: Handle cases where the queue is empty or initializing.

## 3. Cost Controls & Estimations
- [ ] **Usage Tracking**: enhanced `CostEstimator` to track character count per session.
- [ ] **Visual Indicator**: Add a small indicator (e.g., "$0.05") showing estimated cost for the current session when using paid providers.
- [ ] **Threshold Warnings**:
  - [ ] If a user selects "Read Whole Chapter" with a paid provider, show a confirmation dialog with estimated cost.
  - [ ] Add a "Daily Limit" setting (soft limit) that warns when exceeded.

## 4. Pre-fetching & Optimization
- [ ] **Buffer Logic**: Update `AudioPlayerService` to trigger synthesis for segment N+1 while N is playing.
- [ ] **Concurrency**: Ensure pre-fetching doesn't block the UI or cause race conditions.
- [ ] **Cache Hit UI**: visual indication (e.g., icon color) if a segment is playing from cache vs network.

## 5. Playback Robustness
- [ ] **Auto-Fallback**: If a cloud request fails (401/429/500), automatically switch the *current segment* to WebSpeech without stopping playback.
- [ ] **Network Handling**: Pause playback gracefully if offline (unless cached), resume when online.
