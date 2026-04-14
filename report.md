## Debugging Report: Bluetooth Headset Dragnet Capture (Audiobook Mark) Gesture Failure

### Issue Description
The user reported that performing the "pause then play" gesture via a Bluetooth headset on Android did not trigger the expected "audiobook mark" (Dragnet Capture) functionality.

### Root Cause Analysis
In the codebase, the Dragnet Capture gesture is evaluated and triggered inside the `play()` method of `AudioPlayerService`. Specifically, `play()` checks if the time difference between the current time and `lastUserPauseTimestamp` is less than or equal to 5000 milliseconds (5 seconds). If it is, it executes the `executeDragnetCapture()` method before continuing playback.

However, hardware media controls (like Bluetooth headset buttons, lock screen controls, and the notification center) interface with the system via `PlatformIntegration`, which triggers system-level callbacks.
When setting up `PlatformIntegration` in `AudioPlayerService`, the `onPlay` system event was mapped directly to `this.resume()` rather than `this.play()`:

```typescript
this.platformIntegration = new PlatformIntegration({
    onPlay: () => this.resume(),
    onPause: () => this.pause(),
    // ...
});
```

The `resume()` method bypasses the `play()` method entirely, immediately calling `resumeInternal()` without checking `lastUserPauseTimestamp`. Because of this, any "play" command initiated from external hardware bypasses the logic designed to evaluate the 5-second Dragnet Capture window.

### Fix
Modify the `PlatformIntegration` setup in `AudioPlayerService` to map the `onPlay` event to `this.play()` instead of `this.resume()`. The `play()` method inherently checks the `lastUserPauseTimestamp` to decide whether to trigger the Dragnet Capture. If playback is currently paused, `play()` internally falls back to calling `resumeInternal()` (via `playInternal(false)`), so standard playback resuming behavior remains fully intact while now properly evaluating the gesture condition.
