// verification/mock_tts_polyfill.js
(function() {
    console.log("🛠️ Injecting Mock TTS Polyfill...");

    // 1. Create Debug Element
    function createDebugElement() {
        if (document.getElementById('tts-debug-output')) return;

        const debugEl = document.createElement('div');
        debugEl.id = 'tts-debug-output';
        debugEl.style.display = 'block';
        debugEl.style.position = 'fixed';
        debugEl.style.bottom = '0';
        debugEl.style.right = '0';
        debugEl.style.background = 'rgba(0,0,0,0.8)';
        debugEl.style.color = 'lime';
        debugEl.style.padding = '5px';
        debugEl.style.zIndex = '9999';
        debugEl.style.fontSize = '12px';
        debugEl.style.pointerEvents = 'none';

        if (document.body) {
            document.body.appendChild(debugEl);
        } else {
             window.addEventListener('DOMContentLoaded', () => {
                 document.body.appendChild(debugEl);
             });
        }
    }

    if (document.body) createDebugElement();
    else window.addEventListener('DOMContentLoaded', createDebugElement);

    // 2. Define Mock Classes

    // Map to store active utterances by ID for event routing
    const utteranceRegistry = new Map();

    class MockSpeechSynthesisVoice {
        constructor(name, lang, defaultVoice = false) {
            this.name = name;
            this.lang = lang;
            this.localService = true;
            this.default = defaultVoice;
            this.voiceURI = name;
        }
    }

    class MockSpeechSynthesisEvent extends Event {
        constructor(type, eventInitDict) {
            super(type, eventInitDict);
            this.charIndex = eventInitDict?.charIndex || 0;
            this.charLength = eventInitDict?.charLength || 0;
            this.elapsedTime = eventInitDict?.elapsedTime || 0;
            this.name = eventInitDict?.name || '';
            this.utterance = eventInitDict?.utterance || null;
        }
    }

    class MockSpeechSynthesisUtterance extends EventTarget {
        constructor(text) {
            super();
            this.text = text;
            this.lang = 'en-US';
            this.pitch = 1.0;
            this.rate = 1.0;
            this.voice = null;
            this.volume = 1.0;

            this.onstart = null;
            this.onend = null;
            this.onerror = null;
            this.onboundary = null;
            this.onpause = null;
            this.onresume = null;
            this.onmark = null;

            this._id = Math.random().toString(36).substr(2, 9);
            utteranceRegistry.set(this._id, this);
        }
    }

    class MockSpeechSynthesis extends EventTarget {
        constructor() {
            super();
            this._voices = [
                new MockSpeechSynthesisVoice('Mock Male', 'en-US', true),
                new MockSpeechSynthesisVoice('Mock Female', 'en-US', false)
            ];
            this.speaking = false;
            this.paused = false;
            this.pending = false;
            this.onvoiceschanged = null;

            this._connectToSW();
        }

        _connectToSW() {
            if ('serviceWorker' in navigator) {
                // Register SW if not already (best effort)
                navigator.serviceWorker.register('/mock-tts-sw.js')
                    .then(registration => {
                        console.log('Mock TTS SW registered');
                        navigator.serviceWorker.addEventListener('message', (event) => {
                             this._handleMessage(event.data);
                        });
                    })
                    .catch(err => console.error('Mock TTS SW registration failed', err));
            }
        }

        _handleMessage(data) {
             const { type, utteranceId } = data;

             // Retrieve the correct utterance instance
             const u = utteranceRegistry.get(utteranceId);
             if (!u) {
                 // Might happen if registry cleared or stale event
                 return;
             }

             const debugEl = document.getElementById('tts-debug-output');

             switch (type) {
                 case 'start':
                     this.speaking = true;
                     const startEvent = new MockSpeechSynthesisEvent('start', { utterance: u });
                     u.dispatchEvent(startEvent);
                     if (u.onstart) u.onstart(startEvent);
                     break;
                 case 'boundary':
                     const boundaryEvent = new MockSpeechSynthesisEvent('boundary', {
                        utterance: u,
                        charIndex: data.charIndex,
                        charLength: data.charLength,
                        name: data.name
                     });

                     // Update debug DOM
                     if (debugEl) {
                         debugEl.textContent = `[${data.name}] (idx: ${data.charIndex})`;
                         debugEl.setAttribute('data-char-index', data.charIndex);
                         debugEl.setAttribute('data-word', data.name);
                     }

                     u.dispatchEvent(boundaryEvent);
                     if (u.onboundary) u.onboundary(boundaryEvent);
                     break;
                 case 'end':
                     // If queue empty, speaking = false
                     // But we don't know queue state here easily without mirroring it.
                     // For now, assume if one ends, we might be done unless another starts.
                     // A better way is to track pending count.
                     // But strictly speaking, native `speaking` flag stays true if queue has more.
                     // We'll relax this check for now or set it false temporarily.

                     this.speaking = false; // Will flip back to true on next start
                     const endEvent = new MockSpeechSynthesisEvent('end', { utterance: u });
                     u.dispatchEvent(endEvent);
                     if (u.onend) u.onend(endEvent);

                     // Cleanup
                     utteranceRegistry.delete(utteranceId);
                     break;
                 case 'pause':
                     this.paused = true;
                     const pauseEvent = new MockSpeechSynthesisEvent('pause', { utterance: u });
                     u.dispatchEvent(pauseEvent);
                     if (u.onpause) u.onpause(pauseEvent);
                     break;
                 case 'resume':
                     this.paused = false;
                     const resumeEvent = new MockSpeechSynthesisEvent('resume', { utterance: u });
                     u.dispatchEvent(resumeEvent);
                     if (u.onresume) u.onresume(resumeEvent);
                     break;
             }
        }

        getVoices() {
            return this._voices;
        }

        speak(utterance) {
            // Ensure utterance is ours
            if (!(utterance instanceof MockSpeechSynthesisUtterance)) {
                 console.warn("MockSpeechSynthesis.speak called with non-mock utterance. Converting...");
                 const newU = new MockSpeechSynthesisUtterance(utterance.text);
                 newU.rate = utterance.rate;
                 newU.voice = utterance.voice;
                 // Copy callbacks
                 newU.onstart = utterance.onstart;
                 newU.onend = utterance.onend;
                 newU.onerror = utterance.onerror;
                 newU.onboundary = utterance.onboundary;
                 utterance = newU;
            } else {
                // Ensure it's in registry (it should be)
                if (!utteranceRegistry.has(utterance._id)) {
                    utteranceRegistry.set(utterance._id, utterance);
                }
            }

            this.speaking = true;
            this.paused = false;

            const sendSpeak = () => {
                if (navigator.serviceWorker.controller) {
                    navigator.serviceWorker.controller.postMessage({
                        type: 'SPEAK',
                        payload: {
                            text: utterance.text,
                            rate: utterance.rate,
                            id: utterance._id
                        }
                    });
                } else {
                    console.warn("No SW controller found, retrying in 100ms...");
                    setTimeout(sendSpeak, 100);
                }
            };
            sendSpeak();
        }

        cancel() {
            this.speaking = false;
            this.paused = false;
            utteranceRegistry.clear(); // Clear all
             if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'CANCEL' });
            }
        }

        pause() {
            this.paused = true;
             if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'PAUSE' });
            }
        }

        resume() {
            this.paused = false;
             if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({ type: 'RESUME' });
            }
        }
    }

    // 3. Perform Global Replacement

    const mockSynth = new MockSpeechSynthesis();

    // Replace SpeechSynthesisUtterance
    try {
        window.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    } catch(e) { console.error("Failed to replace SpeechSynthesisUtterance", e); }

    // Replace SpeechSynthesisEvent
    try {
        window.SpeechSynthesisEvent = MockSpeechSynthesisEvent;
    } catch(e) { console.error("Failed to replace SpeechSynthesisEvent", e); }

    // Replace SpeechSynthesisVoice
    try {
        window.SpeechSynthesisVoice = MockSpeechSynthesisVoice;
    } catch(e) { console.error("Failed to replace SpeechSynthesisVoice", e); }

    // Replace speechSynthesis (The singleton)
    // First, try to delete the existing property (if it's configurable)
    try {
        delete window.speechSynthesis;
    } catch (e) {
        console.warn("Could not delete window.speechSynthesis", e);
    }

    // Now define it
    try {
        Object.defineProperty(window, 'speechSynthesis', {
            value: mockSynth,
            writable: true,
            configurable: true,
            enumerable: true
        });
    } catch (e) {
        console.error("Failed to define window.speechSynthesis", e);
    }

    // Dispatch voiceschanged to unblock app
    setTimeout(() => {
        const event = new Event('voiceschanged');
        mockSynth.dispatchEvent(event);
        if (mockSynth.onvoiceschanged) {
            mockSynth.onvoiceschanged(event);
        }
    }, 100);

    console.log("✅ Mock TTS Polyfill injection complete.");
})();
