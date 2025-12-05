// verification/tts-polyfill.js

(function() {
    if (window.__mockTTSLoaded) return;
    window.__mockTTSLoaded = true;

    console.log('%c 🗣️ [MockTTS] Injecting Polyfill (Web Worker)', 'background: #222; color: #bada55');

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

    // Initialize Web Worker
    let worker = null;
    try {
        worker = new Worker('/mock-tts-worker.js');
        console.log('🗣️ [MockTTS] Worker Initialized');

        worker.onmessage = (event) => {
             const synth = window.speechSynthesis;
             if (synth && synth._handleMessage) {
                 synth._handleMessage(event.data);
             }
        };
        worker.onerror = (e) => {
            console.error('🗣️ [MockTTS] Worker Error', e);
        };
    } catch(e) {
        console.error('🗣️ [MockTTS] Failed to create Worker', e);
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
            this._utteranceMap = new Map();
        }

        getVoices() {
            return this._voices;
        }

        speak(utterance) {
            console.log('🗣️ [MockTTS] speak called:', utterance.text.substring(0, 50));
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

            if (worker) {
                 console.log('🗣️ [MockTTS] sending SPEAK to Worker');
                 worker.postMessage(msg);
            } else {
                console.error('🗣️ [MockTTS] No Worker available');
            }
        }

        cancel() {
            console.log('🗣️ [MockTTS] cancel called');
            this.speaking = false;
            this.paused = false;
            this.pending = false;
            const msg = { type: 'CANCEL' };
            if (worker) {
                worker.postMessage(msg);
            }
            this._utteranceMap.clear();
             const debugEl = document.getElementById('tts-debug');
             if (debugEl) {
                 debugEl.textContent = '[[CANCELED]]';
                 debugEl.setAttribute('data-status', 'canceled');
             }
        }

        pause() {
            console.log('🗣️ [MockTTS] pause called');
            this.paused = true;
            const msg = { type: 'PAUSE' };
            if (worker) {
                worker.postMessage(msg);
            }
             const debugEl = document.getElementById('tts-debug');
             if (debugEl) {
                 debugEl.textContent = '[[PAUSED]]';
                 debugEl.setAttribute('data-status', 'paused');
             }
        }

        resume() {
             console.log('🗣️ [MockTTS] resume called');
             if (this.paused) {
                 this.paused = false;
                 const msg = { type: 'RESUME' };
                 if (worker) {
                     worker.postMessage(msg);
                 }
                 const debugEl = document.getElementById('tts-debug');
                 if (debugEl) {
                     debugEl.textContent = '[[RESUMED]]';
                     debugEl.setAttribute('data-status', 'resumed');
                 }
             }
        }

        _handleMessage(data) {
            console.log('🗣️ [MockTTS] _handleMessage received:', data.type, data);

            if (data.type === 'LOG') {
                console.log(`🗣️ [MockTTS-Worker] ${data.payload}`);
                return;
            }

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
                     debugEl.setAttribute('data-status', 'start');
                }
                 if (type === 'end') {
                     debugEl.textContent = '[[END]]';
                     debugEl.setAttribute('data-status', 'end');
                     this._utteranceMap.delete(id);
                }
            }

            // Dispatch events
            let event;
            if (type === 'boundary') {
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

        Object.defineProperty(window, 'speechSynthesis', {
            value: mockSynth,
            writable: true,
            configurable: true
        });

        console.log('🗣️ [MockTTS] window.speechSynthesis overwritten');

        setTimeout(() => {
             console.log('🗣️ [MockTTS] Dispatching voiceschanged');
             mockSynth.dispatchEvent(new Event('voiceschanged'));
             if (mockSynth.onvoiceschanged) mockSynth.onvoiceschanged(new Event('voiceschanged'));
        }, 500);

    } catch (e) {
        console.error('🗣️ [MockTTS] Failed to overwrite window.speechSynthesis', e);
    }

})();
