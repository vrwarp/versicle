// mock-tts-sw.js - Service Worker for Mock TTS
const VERSION = '1.1.0';

self.addEventListener('install', (event) => {
    self.skipWaiting(); // Activate immediately
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// State
let utteranceQueue = [];
let currentUtterance = null;
let isPaused = false;
let timerId = null;
let wordQueue = [];
let wordIndex = 0;

function log(msg, ...args) {
    console.log(`%c 🗣️ [MockTTS-SW]: ${msg}`, 'color: #0f0; background: #000; padding: 2px 4px; border-radius: 2px;', ...args);
}

function processQueue() {
    if (currentUtterance) {
        if (isPaused) return; // Wait until resumed
        // Already speaking, do nothing unless we need to resume?
        // processNextWord is handling the loop.
        return;
    }

    if (utteranceQueue.length === 0) return;

    // Dequeue next
    currentUtterance = utteranceQueue.shift();
    wordQueue = tokenize(currentUtterance.text);
    wordIndex = 0;

    log(`Starting: "${currentUtterance.text.substring(0, 20)}..." ID: ${currentUtterance.id}`);

    broadcast({ type: 'start', utteranceId: currentUtterance.id });

    // Start processing words
    processNextWord();
}

function processNextWord() {
    if (!currentUtterance || isPaused) return;

    if (wordIndex >= wordQueue.length) {
        // End of utterance
        finishCurrentUtterance();
        return;
    }

    const wordObj = wordQueue[wordIndex];
    const word = wordObj.word;
    const index = wordObj.index;

    // Calculate duration
    // Formula: (60 / WPM) * 1000 * (1 / rate)
    // Default WPM = 150
    const wpm = 150;
    const rate = currentUtterance.rate || 1.0;
    const duration = ((60 / wpm) * 1000) * (1 / rate);

    // Emit boundary
    broadcast({
        type: 'boundary',
        utteranceId: currentUtterance.id,
        charIndex: index,
        charLength: word.length,
        name: word
    });

    log(`Speaking: "${word}" (idx: ${index})`);

    wordIndex++;
    timerId = setTimeout(processNextWord, duration);
}

function finishCurrentUtterance() {
    if (!currentUtterance) return;

    log(`Finished: ${currentUtterance.id}`);
    broadcast({ type: 'end', utteranceId: currentUtterance.id });

    currentUtterance = null;
    timerId = null;

    // Continue queue
    processQueue();
}

function tokenize(text) {
    const tokens = [];
    // Simple split by whitespace, but keeping track of indices
    const parts = text.split(/(\s+)/);

    let index = 0;
    parts.forEach(part => {
        if (part.trim().length > 0) {
            tokens.push({ word: part, index: index });
        }
        index += part.length;
    });
    return tokens;
}

function handleSpeak(payload) {
    // Add to queue
    utteranceQueue.push(payload);
    log(`Queued: "${payload.text.substring(0, 10)}..." (Queue size: ${utteranceQueue.length})`);

    if (!currentUtterance && !isPaused) {
        processQueue();
    }
}

function handleCancel() {
    if (timerId) clearTimeout(timerId);
    timerId = null;

    // Clear queue
    utteranceQueue = [];

    // Stop current (native cancel doesn't emit end, but we might want to clear state)
    if (currentUtterance) {
        log(`Cancelled: ${currentUtterance.id}`);
        // Native spec says: cancel() removes all utterances from the queue.
        // If an utterance is being spoken, it stops. It does NOT fire 'end' event.
        // It fires an 'error' event with 'canceled' (sometimes)?
        // Or simply stops.

        // Let's fire an error or just stop silent?
        // Web Speech API usually fires 'error' with code 'canceled' or 'interrupted'.
        // But for our app purposes, simple stop is enough.
        // However, we MUST clear currentUtterance so we can speak again.
    }

    currentUtterance = null;
    isPaused = false;
}

function handlePause() {
    if (isPaused) return;
    isPaused = true;
    if (timerId) {
        clearTimeout(timerId);
        timerId = null;
    }
    log("Paused");
    // Broadcast pause event? Native emits 'pause' on utterance
    if (currentUtterance) {
        broadcast({ type: 'pause', utteranceId: currentUtterance.id });
    }
}

function handleResume() {
    if (!isPaused) return;
    isPaused = false;
    log("Resumed");

    if (currentUtterance) {
        broadcast({ type: 'resume', utteranceId: currentUtterance.id });
        processNextWord();
    } else {
        processQueue();
    }
}

self.addEventListener('message', (event) => {
    const data = event.data;
    switch (data.type) {
        case 'SPEAK':
            handleSpeak(data.payload);
            break;
        case 'CANCEL':
            handleCancel();
            break;
        case 'PAUSE':
            handlePause();
            break;
        case 'RESUME':
            handleResume();
            break;
    }
});

function broadcast(msg) {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => client.postMessage(msg));
    });
}
