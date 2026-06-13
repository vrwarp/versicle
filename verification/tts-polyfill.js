// verification/tts-polyfill.js
//
// Mock implementation of the Web Speech API for e2e tests.
//
// The speech "engine" (word-by-word timing that drives start/boundary/end events)
// runs ON THE MAIN THREAD via setTimeout. It used to live in a Web Worker
// (public/mock-tts-worker.js), but WebKit's worker<->main postMessage delivery is
// unreliable in the headless test container: messages (e.g. the 'start' event, or a
// 'PAUSE') intermittently get dropped or stalled. Because the app's WebSpeechProvider
// resolves play() on the utterance 'start' event and serialises play/pause through a
// single task chain, a dropped 'start' wedges the whole TTS sequencer — which is exactly
// why the audio-bookmarking journey was WebKit-flaky. Running the engine inline removes
// the worker message channel entirely, so the events fire deterministically.

(function () {
    if (window.__mockTTSLoaded) return;
    window.__mockTTSLoaded = true;

    console.log('%c 🗣️ [MockTTS] Injecting Polyfill (main thread)', 'background: #222; color: #bada55');

    const WPM = 150;
    const BASE_MS_PER_WORD = (60 / WPM) * 1000; // 400ms/word at rate 1

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
            // Decorative test-harness readout (never shipped to users). Hide it
            // from the a11y tree so the reader-surface axe scan does not count it
            // as an unlandmarked 'region' node once TTS has been exercised.
            debugEl.setAttribute('aria-hidden', 'true');
            document.body.appendChild(debugEl);
        }
        return debugEl;
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureDebugElement);
    } else {
        ensureDebugElement();
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

            // Main-thread speech engine state (was the Web Worker).
            this._state = 'IDLE'; // IDLE | SPEAKING | PAUSED
            this._queue = [];     // pending utterances
            this._current = null; // { utterance, words: [{word, index}], wordIndex }
            this._timer = null;
        }

        getVoices() {
            return this._voices;
        }

        speak(utterance) {
            console.log('🗣️ [MockTTS] speak called:', (utterance.text || '').substring(0, 50));
            this.speaking = true;

            // Update debug element with rate for test verification
            const debugEl = ensureDebugElement();
            if (debugEl) {
                debugEl.setAttribute('data-rate', String(utterance.rate));
            }

            this._queue.push(utterance);
            if (this._state === 'IDLE') {
                this._processNext();
            }
        }

        cancel() {
            console.log('🗣️ [MockTTS] cancel called');
            if (this._timer) {
                clearTimeout(this._timer);
                this._timer = null;
            }
            this._queue = [];
            this._current = null;
            this._state = 'IDLE';
            this.speaking = false;
            this.paused = false;
            this.pending = false;

            const debugEl = ensureDebugElement();
            if (debugEl) {
                debugEl.textContent = '[[CANCELED]]';
                debugEl.setAttribute('data-status', 'canceled');
            }
        }

        pause() {
            console.log('🗣️ [MockTTS] pause called');
            this.paused = true;
            if (this._state === 'SPEAKING') {
                this._state = 'PAUSED';
                if (this._timer) {
                    clearTimeout(this._timer);
                    this._timer = null;
                }
            }
            const debugEl = ensureDebugElement();
            if (debugEl) {
                debugEl.textContent = '[[PAUSED]]';
                debugEl.setAttribute('data-status', 'paused');
            }
        }

        resume() {
            console.log('🗣️ [MockTTS] resume called');
            if (this.paused) {
                this.paused = false;
                const debugEl = ensureDebugElement();
                if (debugEl) {
                    debugEl.textContent = '[[RESUMED]]';
                    debugEl.setAttribute('data-status', 'resumed');
                }
                if (this._state === 'PAUSED') {
                    this._state = 'SPEAKING';
                    this._scheduleNextWord();
                }
            }
        }

        _processNext() {
            if (this._queue.length === 0) {
                this._state = 'IDLE';
                return;
            }

            this._state = 'SPEAKING';
            const utterance = this._queue.shift();
            const text = utterance.text || '';
            const tokens = text.match(/\S+/g) || [];

            const words = [];
            let searchIndex = 0;
            for (const token of tokens) {
                const index = text.indexOf(token, searchIndex);
                words.push({ word: token, index });
                searchIndex = index + token.length;
            }

            this._current = { utterance, words, wordIndex: 0 };

            this._dispatch(utterance, 'start', { charIndex: 0 });
            this._scheduleNextWord();
        }

        _scheduleNextWord() {
            const cur = this._current;
            if (!cur) return;

            if (cur.wordIndex >= cur.words.length) {
                const utterance = cur.utterance;
                this._current = null;
                this._dispatch(utterance, 'end', { charIndex: (utterance.text || '').length });
                this._processNext();
                return;
            }

            const wordObj = cur.words[cur.wordIndex];
            const rate = cur.utterance.rate || 1;
            const delay = BASE_MS_PER_WORD / rate;

            this._timer = setTimeout(() => {
                this._timer = null;
                // Guard against cancel()/pause() that cleared current mid-timeout.
                if (this._state !== 'SPEAKING' || this._current !== cur) return;

                this._dispatch(cur.utterance, 'boundary', {
                    charIndex: wordObj.index,
                    charLength: wordObj.word.length,
                    name: 'word',
                    text: wordObj.word
                });

                cur.wordIndex++;
                this._scheduleNextWord();
            }, delay);
        }

        _dispatch(utterance, type, data) {
            const debugEl = ensureDebugElement();
            if (debugEl) {
                debugEl.setAttribute('data-last-event', type);
                if (type === 'start') {
                    debugEl.setAttribute('data-status', 'start');
                } else if (type === 'boundary') {
                    debugEl.textContent = data.text || '';
                    debugEl.setAttribute('data-char-index', String(data.charIndex));
                    debugEl.setAttribute('data-status', 'speaking');
                } else if (type === 'end') {
                    debugEl.textContent = '[[END]]';
                    debugEl.setAttribute('data-status', 'end');
                }
            }

            let event;
            if (type === 'boundary') {
                event = new SpeechSynthesisEvent('boundary', { utterance, charIndex: data.charIndex, name: data.name, charLength: data.charLength });
                if (utterance.onboundary) utterance.onboundary(event);
            } else if (type === 'start') {
                event = new SpeechSynthesisEvent('start', { utterance, charIndex: 0 });
                if (utterance.onstart) utterance.onstart(event);
            } else if (type === 'end') {
                event = new SpeechSynthesisEvent('end', { utterance, charIndex: data.charIndex });
                if (utterance.onend) utterance.onend(event);
            }

            if (event) utterance.dispatchEvent(event);
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
