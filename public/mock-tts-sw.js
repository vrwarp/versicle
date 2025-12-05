// public/mock-tts-sw.js

const WPM = 150;
const BASE_MS_PER_WORD = (60 / WPM) * 1000;

let state = 'IDLE'; // IDLE, SPEAKING, PAUSED
let queue = []; // Array of { text, rate, client, id }
let currentItem = null;
let words = [];
let currentWordIndex = 0;
let timer = null;

self.addEventListener('install', (event) => {
    console.log('🗣️ [MockTTS] Service Worker Installed');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('🗣️ [MockTTS] Service Worker Activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    const { type, payload } = event.data;
    const client = event.source;

    console.log(`🗣️ [MockTTS] Received ${type}`, payload || '');

    switch (type) {
        case 'SPEAK':
            handleSpeak(payload, client);
            break;
        case 'PAUSE':
            handlePause();
            break;
        case 'RESUME':
            handleResume();
            break;
        case 'CANCEL':
            handleCancel();
            break;
    }
});

function handleSpeak(payload, client) {
    const { text, rate, id } = payload;
    const item = { text, rate: rate || 1, client, id };

    queue.push(item);

    if (state === 'IDLE') {
        processNext();
    }
}

function handlePause() {
    if (state === 'SPEAKING') {
        state = 'PAUSED';
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        console.log('🗣️ [MockTTS] Paused');
        // Notify client? Native API doesn't emit 'pause' event on utterance,
        // but the synth has a paused state. The polyfill handles that state.
    }
}

function handleResume() {
    if (state === 'PAUSED') {
        console.log('🗣️ [MockTTS] Resuming');
        state = 'SPEAKING';
        scheduleNextWord();
    }
}

function handleCancel() {
    console.log('🗣️ [MockTTS] Canceling');
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }

    // Notify error/end for current?
    // Usually cancel just stops everything.
    // We should probably emit an error or just stop?
    // Native behavior: cancel() fires error event on current utterance?
    // MDN: "The cancel() method ... removes all utterances from the utterance queue. If an utterance is currently being spoken, the error event is fired on that SpeechSynthesisUtterance object."

    if (currentItem) {
       // We don't necessarily fire error in all browsers, but let's be consistent.
       // Actually often it fires 'end' or nothing?
       // Let's fire 'error' with error: 'canceled' just in case, or just nothing and clear queue.
       // The polyfill might handle the event firing if we tell it we are clearing.
    }

    queue = [];
    currentItem = null;
    words = [];
    currentWordIndex = 0;
    state = 'IDLE';
}

function processNext() {
    if (queue.length === 0) {
        state = 'IDLE';
        return;
    }

    state = 'SPEAKING';
    currentItem = queue.shift();
    // Tokenize
    // Split by whitespace, keeping punctuation attached to previous word
    // Actually simple split is fine as long as charIndex is correct.
    // We need accurate charIndex for highlighting.

    const text = currentItem.text;
    const tokens = text.match(/\S+/g) || [];

    // Map tokens to { word, index }
    words = [];
    let searchIndex = 0;
    for (const token of tokens) {
        const index = text.indexOf(token, searchIndex);
        words.push({ word: token, index });
        searchIndex = index + token.length;
    }

    currentWordIndex = 0;

    // Emit start
    notifyClient(currentItem.client, 'start', { id: currentItem.id });

    scheduleNextWord();
}

function scheduleNextWord() {
    if (currentWordIndex >= words.length) {
        // Finished current item
        notifyClient(currentItem.client, 'end', { id: currentItem.id });
        currentItem = null;
        processNext();
        return;
    }

    const wordObj = words[currentWordIndex];
    const delay = BASE_MS_PER_WORD / currentItem.rate;

    timer = setTimeout(() => {
        // Emit boundary
        console.log(`%c 🗣️ [MockTTS]: "${wordObj.word}"`, 'color: #4ade80; font-weight: bold;');

        notifyClient(currentItem.client, 'boundary', {
            id: currentItem.id,
            charIndex: wordObj.index,
            charLength: wordObj.word.length,
            name: 'word',
            text: wordObj.word // Extra field for convenience
        });

        currentWordIndex++;
        scheduleNextWord();
    }, delay);
}

function notifyClient(client, type, data) {
    if (client) {
        client.postMessage({ type, ...data });
    }
}
