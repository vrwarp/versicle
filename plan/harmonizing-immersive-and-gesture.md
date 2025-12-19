Product Spec: Unified "Flow Mode" (Harmonizing Reader & Player)
===============================================================

1\. Executive Summary
---------------------

### 1.1 The Problem: Modal Friction

Currently, Versicle treats visual reading ("Immersive Mode") and auditory consumption ("Gesture Mode") as distinct, mutually exclusive application states. This separation creates a jarring user experience, forcing users to make a binary choice between "looking" and "listening." To switch contexts---for example, to briefly glance at a diagram while listening, or to let the TTS take over when eyes get tired---the user must manually toggle modes. This interaction introduces unnecessary friction, breaks the immersive state ("flow"), and increases cognitive load by requiring the user to navigate UI chrome rather than interacting directly with the content.

### 1.2 The Solution: Flow Mode

This specification proposes **"Flow Mode,"** a unified interface paradigm where the application's state is fluid rather than static. Instead of a manual toggle, the **state of the content (Playing vs. Paused)** dictates the interaction model.

There is no longer a "Gesture Mode" switch. The interface is always "Immersive." However, it intelligently adapts its input listeners, visual feedback, and affordances based on the user's current activity. If the audio engine is active, the interface assumes a "Listening" context; if paused, it reverts to a "Reading" context. This approach harmonizes the two experiences into a single continuum, allowing users to drift seamlessly between reading and listening without ever leaving the content view.

2\. Design Philosophy
---------------------

### 2.1 Content Dictates Form

The core philosophy is "Intent Inference." We infer the user's intent based on the state of the media engine.

-   **Reading Intent:** When audio is paused, the user is likely looking at the screen. The UI prioritizes visual navigation (page turns), precise text selection, and access to visual settings.

-   **Listening Intent:** When audio is playing, we assume the user's visual attention may be compromised (walking, driving, doing chores) or that the device is pocketed. The UI prioritizes "blind" macro-interactions (swipes, large tap targets) and playback control.

### 2.2 Invisible Mode Switching

The transition between states must be perceptible but unobtrusive. We remove the cognitive overhead of "switching modes" by making the switch implicit.

-   **Seamlessness:** Starting audio via a double-tap should feel as natural as turning a page. The interface transforms instantly but subtly, using fluid animations rather than hard layout changes.

-   **Context Preservation:** When switching from Listening to Reading (by pausing), the user lands exactly where the audio stopped, with the relevant text paragraph highlighted and centered.

### 2.3 Pocket-First Safety

A critical requirement for the Listening state is "Pocket-First" design.

-   **Eyes-Free Interaction:** A user should be able to pause, resume, skip back, or adjust speed without looking at the screen.

-   **Accidental Touch Prevention:** The interface must be robust enough to handle the chaotic environment of a pocket or a wet hand in the kitchen. This implies prioritizing gesture complexity (swipes/double taps) over simple taps for critical actions when in Listening mode.

3\. The Two States
------------------

### State A: Visual Reading (Audio Paused)

This is the default state when the user opens a book or pauses playback.

-   **Context:** The user has visual fixity on the screen. The device is likely held in hand or propped on a stand.

-   **Primary Actions:** Turning pages, highlighting text, looking up words, checking footnotes.

-   **Visuals:**

    -   **Typography:** Crisp, high-contrast text rendered according to user settings (font size, line height).

    -   **Chrome:** Minimal or hidden. The HUD (Heads Up Display) is summoned only on demand.

    -   **Focus:** The current paragraph is clear, but the entire page is accessible.

### State B: Audio Listening (Audio Playing)

This state activates the moment the TTS engine begins generating audio.

-   **Context:** The user is likely multitasking. Visual attention is intermittent or non-existent. The device might be face-down, in a pocket, or docked in a car.

-   **Primary Actions:** Pausing, skipping boring sections, rewinding to re-listen, adjusting speed/volume.

-   **Visuals:**

    -   **Dynamic Feedback:** Subtle visual cues (pulsing borders, dimming) indicate the app is "alive" without needing to read text.

    -   **Auto-Scrolling:** The text keeps pace with the audio automatically, ensuring that if the user *does* glance at the screen, the active sentence is vertically centered.

    -   **Battery Saver:** Support for a "Screen Curtain" (OLED blackout) to extend battery life during long listening sessions.

4\. Interaction Matrix
----------------------

The core of Flow Mode is a context-aware input map. The same physical area of the screen triggers different logic depending on the active state.

|

|

Input Gesture

 |

**Visual Reading State** (Audio Paused)

 |

**Audio Listening State** (Audio Playing)

 |
|

**Tap (Left 20%)**

 |

**Prev Page**

 |

**Seek Back** (Default: Sentence or 15s)

 |
|

**Tap (Right 20%)**

 |

**Next Page**

 |

**Seek Forward** (Default: Sentence or 15s)

 |
|

**Tap (Center 60%)**

 |

**Toggle HUD** (Settings/Library)

 |

**Pause Audio** (Return to Reading State)

 |
|

**Double Tap**

 |

**Start Audio** (Enter Listening State)

 |

**Toggle Curtain** (Blackout screen for pocket)

 |
|

**Swipe Horizontal**

 |

*Ignored* (Native page turn animation)

 |

**Scrub / Seek Chapter** (Left=Prev, Right=Next)

 |
|

**Swipe Vertical**

 |

*Ignored* (or Native Scroll)

 |

**Adjust Variable** (Up=Speed/Vol+, Down=Speed/Vol-)

 |
|

**Long Press**

 |

**Select Text / Annotate**

 |

**Add Bookmark** (Timestamp)

 |
|

**Two-Finger Tap**

 |

*No Action*

 |

**Toggle Play/Pause** (Secondary explicit toggle)

 |

 |

#### Detailed Interaction Logic

1.  **Smart Seek vs. Page Turns:** In Audio Mode, manual page turning is disabled. Why? Because the TTS engine controls the "cursor." If a user manually turned the page while audio was playing, the visual view would desync from the audio. Instead, tapping the edges performs a "Smart Seek"---skipping to the next/previous logical sentence boundary. This keeps the audio and visual cursor in sync.

2.  **Debounce & Safety:** In Listening State, the **Tap Center** action (Pause) is the most critical safety feature. It must be responsive. However, to prevent accidental pauses from brushing against clothing:

    -   **Touch Area:** The target is effectively the entire screen *minus* the 20% side gutters.

    -   **Rejection:** Extremely short "micro-taps" (under 50ms) or large surface area touches (palm rejection) should be ignored.

5\. Visual Feedback Specifications
----------------------------------

Since the input map changes invisibly, the UI *must* provide subtle, non-intrusive cues so the user understands the current mode. "Am I in a book, or am I in a player?"

### 5.1. The "Audio Active" Watermark

When transitioning to **Listening State**, the following visual transformation occurs over a 300ms ease-in-out curve:

1.  **Text Dimming:** The main content opacity reduces slightly (e.g., to 85% or 90%). This improves contrast for the UI overlays and subtly signals that the text is now "secondary" to the audio experience.

2.  **Breathing Border:** A border (approx 4px-6px) fades in around the entire viewport. It pulses slowly (a "breathing" animation, 4s cycle) using the current theme's accent color.

    -   *Purpose:* This framing confirms the app is "live" and listening for gestures. It acts as a "recording light" metaphor.

3.  **Optional Central Glyph:** A very large, extremely faint (3-5% opacity) Play/Pause icon can be centered on the screen. This serves as a watermark indicating the "Tap to Pause" target zone.

### 5.2. Screen Curtain (Double Tap in Listening State)

The Screen Curtain is a dedicated sub-mode for battery conservation and pocket safety.

-   **Activation:** Double-tap anywhere while audio is playing.

-   **Visual:** Completely black screen (`#000000`). This turns off pixels on OLED displays, significantly saving power.

-   **Interaction:**

    -   **Gestures Pass-Through:** Volume swipes, seek swipes, and the pause tap continue to work *through* the curtain.

    -   **Peek Mode:** A *single tap* on the curtain does **not** pause. Instead, it briefly flashes high-contrast white text (time, chapter remaining, battery) for 2 seconds (low brightness), then fades back to black. This allows checking progress without unlocking the full UI.

    -   **Dismissal:** A *double tap* dismisses the curtain, revealing the standard Listening State.

6\. User Journeys
-----------------

### Scenario 1: The Commuter (Hybrid Consumption)

1.  **Reading (Visual):** A user is reading on the bus. The environment is noisy. They are focused on the text, tapping the right edge to turn pages.

2.  **Transition:** The user approaches their transfer stop. They need to walk. They **Double Tap** anywhere on the screen.

3.  **Listening (Audio):** The TTS engine engages instantly. The "Breathing Border" fades in. The user puts the phone in their pocket.

4.  **Blind Adjustment:** Walking down the street, the user finds the reading speed too slow. Reaching into their pocket (without looking), they perform a long **Swipe Up** on the screen. The speed increments to 1.5x.

5.  **Navigation:** The user's mind wanders and they miss a paragraph. They perform a **Swipe Left** (or tap the left side of the phone through the fabric). The audio jumps back to the start of the previous sentence.

6.  **Arrival:** The user sits down on the train. They take the phone out. They **Tap Center**. Audio pauses, the border vanishes, and they resume visual reading exactly where the audio left off.

### Scenario 2: The Kitchen (Messy Hands)

1.  **Listening:** The user is listening to a novel while cooking. The phone is propped on the counter.

2.  **Interrupt:** A critical plot point occurs, and they want to highlight it, but their hands are covered in flour.

3.  **Pause:** They use a clean knuckle to **Tap Center** (a large, forgiving target). Audio stops.

4.  **Annotate:** They wipe a finger and **Long Press** the highlighted sentence to save it to their notes.

5.  **Resume:** They **Double Tap** with a knuckle to resume playback and return to chopping vegetables.

### Scenario 3: Bedtime (Eye Strain)

1.  **Reading:** The user is reading in bed in Dark Mode. Eyes are getting heavy.

2.  **Transition:** They **Double Tap** to switch to audio.

3.  **Curtain:** The screen is still too bright even in Dark Mode. They **Double Tap** again. The "Screen Curtain" engages, turning the screen pitch black.

4.  **Sleep:** The user listens in total darkness. The "Sleep Timer" (set previously) eventually fades the audio out.

7\. Technical Implementation Strategy
-------------------------------------

### Phase 1: State Unification & Store Refactor (COMPLETED)

-   **Deprecate `isGestureMode`:** Removed `gestureMode` from `useReaderStore` (not `useUIStore`). Updated `ReaderView` and `UnifiedAudioPanel` to remove gesture mode toggles.

-   **Introduce `isAudioActive`:** Implemented by subscribing directly to `useTTSStore.isPlaying` in `UnifiedInputController`.

-   **Input Layer:** Created `UnifiedInputController.tsx` which manages both "Visual Reading" and "Listening" states. Replaced `GestureOverlay.tsx` with this new controller.

### Phase 2: Input Logic & Event Propagation (COMPLETED)

-   **Overlay Strategy:**
    -   Implemented a full-screen overlay in `UnifiedInputController` that is active when `isPlaying` is true (Listening State).
    -   When `isPlaying` is false (Visual Reading State), the overlay is effectively removed/hidden.
    -   To support "Double Tap to Start Audio" in Visual Reading State (where overlay is inactive), we updated `useEpubReader` to pass click events from the iframe. `UnifiedInputController` listens to these events via `rendition.on('click')` and implements the tap zone logic (Left/Right/Center) and Double Tap detection.

-   **Conflict Resolution:** Implemented a 300ms delay on single taps to wait for potential double taps in both states.

### Deviations & Discoveries

-   **GestureOverlay Removal:** `GestureOverlay.tsx` was deleted as its functionality is fully subsumed by `UnifiedInputController`.

-   **Click Handling:** Modified `src/hooks/useEpubReader.ts` to pass the `MouseEvent` to the `onClick` handler. This was crucial for implementing tap zones (Left/Right/Center) on the iframe content itself.

-   **Tap Zones:** Implemented explicit tap zones (Left 20%, Right 20%, Center 60%) for the Visual Reading state to support Prev/Next page and Toggle HUD actions, replacing native or undefined behavior.

-   **Overlay Z-Index:** Set `UnifiedInputController` overlay z-index to 30 (below Audio Panel/HUD) to ensure UI controls remain accessible in Listening Mode unless the Screen Curtain (z-100) is active.

-   **UnifiedInputController Enhancements:**
    -   Integrated Battery API for Peek Mode status.
    -   Implemented custom timeout logic for Peek Mode (2s duration).
    -   Added cleanup for event listeners to prevent memory leaks.

### Phase 3: Visual Polish & Transitions (COMPLETED)

-   **CSS Transitions:** Implemented CSS transitions for `opacity` on the main reader container. The switch between states takes 300ms.
    -   Added `breathing` animation in `tailwind.config.js` for the border pulse.
    -   Added text dimming (opacity 0.85) in `ReaderView.tsx`.

-   **Curtain Component:** Built the `ScreenCurtain` logic directly into `UnifiedInputController` as a high z-index overlay (`z-[100]`) with black background.
    -   Implemented "Peek Mode" (Single Tap) showing Time, Chapter Title, and Battery.
    -   Integrated Fullscreen API to hide status bars when Curtain is active.
    -   Added central faint Play/Pause glyph as a "Flow Mode" watermark.

8\. Accessibility Considerations
--------------------------------

### 8.1 Screen Readers (VoiceOver / TalkBack)

-   **State Announcement:** When entering Listening State, the app should announce "Audio Mode Active."

-   **Curtain Safety:** If the Screen Curtain is active, it must **not** hide the UI from the accessibility tree. Screen readers must still be able to find the "Pause" and "Dismiss Curtain" buttons, even if they are visually hidden or black-on-black.

-   **Media Controls:** Ensure standard OS media controls (notification center, lock screen) remain fully functional and synchronized with the internal state.

### 8.2 Motor & Cognitive Accessibility

-   **Target Size:** The "Center Tap" to pause in Listening Mode should be generous (at least 60% of screen width).

-   **Feedback:** Provide haptic feedback (short vibration) on successful gestures (e.g., a tick when speed is adjusted, a thud when pausing) to confirm actions without visual verification.
