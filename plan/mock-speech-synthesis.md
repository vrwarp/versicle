# **Technical Design Document: Deterministic Mock TTS System**

Validation Test Suite for versicle

## **1\. Problem Statement**

The current validation suite relies on the browser's native SpeechSynthesis API. This introduces several indeterministic factors that make automated testing brittle or impossible:

1. **Audio Hardware Dependency:** Tests may fail in CI/CD environments (e.g., Docker containers) lacking audio drivers.  
2. **Variable Timing:** Native TTS timing varies by voice, OS, and system load, making it impossible to assert precise synchronization logic (e.g., highlighting).  
3. **Opaque Execution:** There is no standard way to "read" what is currently being spoken to verify content without analyzing raw audio.

## **2\. Objective**

To implement a full-featured, deterministic polyfill for the Web Speech API (SpeechSynthesis and SpeechSynthesisUtterance) that:

* Runs "headless" (no audio output required).  
* Emits textual representations of spoken content for verification.  
* Adheres to a configurable, deterministic cadence (default: 150 WPM).  
* Maintains the asynchronous, event-driven nature of the native API using a background worker thread.

## **3\. Architecture**

The solution implements a **Client-Server model** entirely within the browser context.

* **The Client (Main Thread):** A Polyfill replacing `window.speechSynthesis` and `window.SpeechSynthesisUtterance`. It handles the API surface area, manages Utterance instances, and bridges communication to the worker.
* **The Server (Service Worker):** A `mock-tts-sw.js` script running in a background thread. It acts as the "Audio Engine," managing the playback queue, calculating word durations, and emitting timing events.

### **3.1 Component Diagram**

```sequenceDiagram  
    participant App as Versicle App  
    participant Poly as Mock Polyfill (Main Thread)  
    participant SW as Service Worker (Background)

    Note over App, Poly: Initialization  
    App->>Poly: window.speechSynthesis.speak(utterance)  
    Poly->>Poly: Store utterance reference  
    Poly->>SW: POST_MESSAGE { type: 'SPEAK', payload: text, rate }

    Note over SW: Processing Loop  
    SW->>SW: Parse text -> words  
    loop Every Word (calculated duration)  
        SW->>Poly: { type: 'boundary', charIndex, word }  
        Poly->>App: utterance.onboundary(event)  
        Poly->>DOM: Update Debug DOM <div id="tts-debug">  
    end

    SW->>Poly: { type: 'end' }  
    Poly->>App: utterance.onend(event)
```

## **4\. Implementation Details**

### **4.1 The Service Worker (mock-tts-sw.js)**

The Service Worker acts as the source of truth for timing. It replaces the opaque "black box" of the OS TTS engine.

* **Cadence Logic:**  
  * Standard WPM: 150\.  
  * Formula: Duration\_ms \= ((60 / WPM) \* 1000\) \* (1 / Rate).  
  * Wait time is calculated per word to simulate natural processing.  
* **Tokenization:**  
  * Input text is split by whitespace to determine "boundaries."  
  * Punctuation is included in the preceding word token.  
* **State Machine:**  
  * IDLE: Queue empty.  
  * SPEAKING: Processing queue.  
  * PAUSED: Queue preserved, timers cleared.

### **4.2 The Polyfill (mock_tts_polyfill.js)**

This component must strictly adhere to the IDL definitions of the Web Speech API to ensure the WebSpeechProvider in the application interacts with it transparently.

* **Robust Injection:**
  * Uses `delete window.speechSynthesis` followed by `Object.defineProperty` to forcibly replace the native global, handling browser-specific read-only properties.
* **Voice Masquerading:**  
  * Must expose getVoices() returning at least one SpeechSynthesisVoice object.  
  * Crucially, it must trigger the voiceschanged event shortly after load to unblock the application's initialization logic.  
* **Event Dispatch:**  
  * Maps messages from the SW (boundary, end) to CustomEvent or direct callback invocations on the specific Utterance object triggering them.

### **4.3 Integration & Verification**

To verify the system visually and programmatically:

1. **Console Emission:** The SW logs %c 🗣️ \[MockTTS\]: "word" to the console with styling, allowing visual confirmation in traces.  
2. **DOM Emission:** The Polyfill appends the currently spoken word to a hidden DOM element (e.g., \#tts-debug-output). Playwright asserts against the text content of this element.

## **5\. Risk Assessment & Mitigation**

| Risk | Impact | Mitigation |
| :---- | :---- | :---- |
| **Race Conditions** | Tests flake if SW registration is slow. | The test setup (conftest.py) must await the serviceworker.ready promise before triggering app logic. |
| **Event Mismatch** | App logic (e.g., highlighting) breaks if charIndex is wrong. | The SW tokenizer must replicate the naive whitespace splitting used by most browser engines for English. |
| **Global Override Failure** | Tests use native TTS or crash. | Polyfill uses `delete` operator and explicit property definition to ensure override success. |

## **6\. Deployment Strategy**

1. Place `mock-tts-sw.js` in `public/` (served at root).
2. Inject `mock_tts_polyfill.js` via Playwright's `add_init_script`.
3. Tests run with no changes to the application code (zero-intrusion testing).
