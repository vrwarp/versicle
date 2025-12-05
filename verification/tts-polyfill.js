// verification/tts-polyfill.js

(function() {
    if (window.__mockTTSLoaded) return;
    window.__mockTTSLoaded = true;

    console.log('%c 🗣️ [MockTTS] Injecting Polyfill', 'background: #222; color: #bada55');

    // Create debug element
    function ensureDebugElement() {
        let debugEl = document.getElementById('tts-debug');
        if (!debugEl && document.body) {
            debugEl = document.createElement('div');
            debugEl.id = 'tts-debug';
            debugEl.style.position = 'fixed';
            debugEl.style.bottom = '10px';
            debugEl.style.right = '10px';
            debugEl.style.background = 'rgba(0,0,0,0.8)';
            debugEl.style.color = 'white';
            debugEl.style.padding = '5px';
            debugEl.style.zIndex = '9999';
            debugEl.style.fontSize = '12px';
            debugEl.style.pointerEvents = 'none';
            debugEl.setAttribute('data-testid', 'tts-debug');
            document.body.appendChild(debugEl);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureDebugElement);
    } else {
        ensureDebugElement();
    }

    // Register Service Worker
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/mock-tts-sw.js')
            .then(reg => {
                console.log('🗣️ [MockTTS] SW Registered', reg);
                // Force update
                if (reg.waiting) {
                    // reg.waiting.postMessage({ type: 'SKIP_WAITING' });
                }
            })
            .catch(err => console.error('🗣️ [MockTTS] SW Registration failed', err));

        navigator.serviceWorker.addEventListener('message', (event) => {
             const synth = window.speechSynthesis;
             if (synth && synth._handleMessage) {
                 synth._handleMessage(event.data);
             }
        });
    } else {
        console.error('🗣️ [MockTTS] Service Worker not supported');
    }

    class MockSpeechSynthesisUtterance extends EventTarget {
        constructor(text) {
            super();
            this.text = text || '';
            this.voice = null;
            this.rate = 1;
            this.pitch = 1;
            this.volume = 1;
            this.lang = '';

            // Events
            this.onstart = null;
            this.onend = null;
            this.onerror = null;
            this.onpause = null;
            this.onresume = null;
            this.onboundary = null;
            this.onmark = null;

            // Internal ID
            this._id = Math.random().toString(36).substring(7);
        }
    }

    class MockSpeechSynthesis extends EventTarget {
        constructor() {
            super();
            this.speaking = false;
            this.paused = false;
            this.pending = false;
            this._voices = [
                 { name: 'Mock Voice 1', lang: 'en-US', default: true, localService: true, voiceURI: 'mock-1' },
                 { name: 'Mock Voice 2', lang: 'en-GB', default: false, localService: true, voiceURI: 'mock-2' }
            ];
            this._utteranceMap = new Map(); // id -> utterance
            this._pendingMessages = [];

            if ('serviceWorker' in navigator) {
                navigator.serviceWorker.addEventListener('controllerchange', () => {
                    console.log('🗣️ [MockTTS] Controller changed - flushing pending messages');
                    this._flushPending();
                });
            }
        }

        _flushPending() {
             if (navigator.serviceWorker.controller) {
                 while (this._pendingMessages.length) {
                     const msg = this._pendingMessages.shift();
                     console.log('🗣️ [MockTTS] Flushing message', msg.type);
                     navigator.serviceWorker.controller.postMessage(msg);
                 }
             }
        }

        getVoices() {
            return this._voices;
        }

        speak(utterance) {
            this.speaking = true;
            this._utteranceMap.set(utterance._id, utterance);

            const msg = {
                 type: 'SPEAK',
                 payload: {
                     text: utterance.text,
                     rate: utterance.rate,
                     id: utterance._id
                 }
            };

            // Send to SW
            if (navigator.serviceWorker.controller) {
                 navigator.serviceWorker.controller.postMessage(msg);
            } else {
                console.log('🗣️ [MockTTS] No SW controller, queueing SPEAK');
                this._pendingMessages.push(msg);
            }
        }

        cancel() {
            this.speaking = false;
            this.paused = false;
            this.pending = false;
            const msg = { type: 'CANCEL' };
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage(msg);
            } else {
                this._pendingMessages.push(msg);
            }
            this._utteranceMap.clear();
             const debugEl = document.getElementById('tts-debug');
             if (debugEl) {
                 debugEl.textContent = '[[CANCELED]]';
                 debugEl.setAttribute('data-status', 'canceled');
             }
        }

        pause() {
            this.paused = true;
            const msg = { type: 'PAUSE' };
            if (navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage(msg);
            } else {
                this._pendingMessages.push(msg);
            }
             const debugEl = document.getElementById('tts-debug');
             if (debugEl) {
                 debugEl.textContent = '[[PAUSED]]';
                 debugEl.setAttribute('data-status', 'paused');
             }
        }

        resume() {
             if (this.paused) {
                 this.paused = false;
                 const msg = { type: 'RESUME' };
                 if (navigator.serviceWorker.controller) {
                     navigator.serviceWorker.controller.postMessage(msg);
                 } else {
                     this._pendingMessages.push(msg);
                 }
                 const debugEl = document.getElementById('tts-debug');
                 if (debugEl) {
                     debugEl.textContent = '[[RESUMED]]';
                     debugEl.setAttribute('data-status', 'resumed');
                 }
             }
        }

        _handleMessage(data) {
            const { type, id, charIndex, name, text } = data;
            const utterance = this._utteranceMap.get(id);
            if (!utterance) return;

            ensureDebugElement();
            const eventInit = { bubbles: false, cancelable: false, utterance };

            // Update Debug DOM
            const debugEl = document.getElementById('tts-debug');
            if (debugEl) {
                debugEl.setAttribute('data-last-event', type);
                if (type === 'boundary') {
                     debugEl.textContent = text || '';
                     debugEl.setAttribute('data-char-index', charIndex);
                     debugEl.setAttribute('data-status', 'speaking');
                }
                if (type === 'start') {
                     // debugEl.textContent = '[[START]]'; // Keep previous text or clear?
                     debugEl.setAttribute('data-status', 'start');
                }
                 if (type === 'end') {
                     debugEl.textContent = '[[END]]';
                     debugEl.setAttribute('data-status', 'end');
                     this._utteranceMap.delete(id);
                }
            }

            // Dispatch events
            // We need to support 'onboundary', 'onstart', 'onend' properties

            let event;
            if (type === 'boundary') {
                 // SpeechSynthesisEvent is globally available
                 event = new SpeechSynthesisEvent('boundary', { ...eventInit, charIndex, name, charLength: data.charLength });
                 if (utterance.onboundary) utterance.onboundary(event);
            } else if (type === 'start') {
                 event = new SpeechSynthesisEvent('start', { ...eventInit, charIndex: 0 });
                 if (utterance.onstart) utterance.onstart(event);
            } else if (type === 'end') {
                 event = new SpeechSynthesisEvent('end', { ...eventInit, charIndex: utterance.text.length });
                 if (utterance.onend) utterance.onend(event);
            }

             utterance.dispatchEvent(event);
        }
    }

    // Always Polyfill SpeechSynthesisEvent to avoid native constructor checks failing with MockUtterance
    window.SpeechSynthesisEvent = class SpeechSynthesisEvent extends Event {
        constructor(type, init) {
            super(type, init);
            this.utterance = init.utterance;
            this.charIndex = init.charIndex || 0;
            this.elapsedTime = init.elapsedTime || 0;
            this.name = init.name || '';
            this.charLength = init.charLength || 0;
        }
    }

    // Overwrite globals
    window.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;

    try {
        const mockSynth = new MockSpeechSynthesis();

        // Handle read-only property using defineProperty
        Object.defineProperty(window, 'speechSynthesis', {
            value: mockSynth,
            writable: true,
            configurable: true
        });

        console.log('🗣️ [MockTTS] window.speechSynthesis overwritten');

        // Trigger voiceschanged
        setTimeout(() => {
             console.log('🗣️ [MockTTS] Dispatching voiceschanged');
             mockSynth.dispatchEvent(new Event('voiceschanged'));
             if (mockSynth.onvoiceschanged) mockSynth.onvoiceschanged(new Event('voiceschanged'));

             // Also dispatch on window if needed (not standard but sometimes assumed)
        }, 500);

    } catch (e) {
        console.error('🗣️ [MockTTS] Failed to overwrite window.speechSynthesis', e);
    }

})();
