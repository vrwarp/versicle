// public/mock-tts-sw.js

const WPM = 150;
const BASE_MS_PER_WORD = (60 / WPM) * 1000;

let state = 'IDLE'; // IDLE, SPEAKING, PAUSED
let queue = []; // Array of { text, rate, client, id }
let currentItem = null;
let words = [];
let currentWordIndex = 0;
let timer = null;

function logToMain(msg, data) {
    const fullMsg = data ? `${msg} ${JSON.stringify(data)}` : msg;
    // console.log(fullMsg);

    self.clients.matchAll().then(clients => {
        for (const c of clients) {
            c.postMessage({ type: 'LOG', payload: fullMsg });
        }
    });
}

self.addEventListener('install', (event) => {
    logToMain('🗣️ [MockTTS] Service Worker Installed');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    logToMain('🗣️ [MockTTS] Service Worker Activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    const { type, payload } = event.data;
    const client = event.source;

    logToMain(`🗣️ [MockTTS] Received ${type}`, payload || '');

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

async function handleSpeak(payload, client) {
    logToMain('🗣️ [MockTTS] handleSpeak', payload.text.substring(0, 20));
    const { text, rate, id } = payload;
    const item = { text, rate: rate || 1, client, id };

    queue.push(item);

    if (state === 'IDLE') {
        processNext();
    }
}

function handlePause() {
    logToMain('🗣️ [MockTTS] handlePause');
    if (state === 'SPEAKING') {
        state = 'PAUSED';
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
        logToMain('🗣️ [MockTTS] Paused');
    }
}

function handleResume() {
    logToMain('🗣️ [MockTTS] handleResume');
    if (state === 'PAUSED') {
        logToMain('🗣️ [MockTTS] Resuming');
        state = 'SPEAKING';
        scheduleNextWord();
    }
}

function handleCancel() {
    logToMain('🗣️ [MockTTS] Canceling');
    if (timer) {
        clearTimeout(timer);
        timer = null;
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
        logToMain('🗣️ [MockTTS] Queue empty, going IDLE');
        return;
    }

    state = 'SPEAKING';
    currentItem = queue.shift();
    logToMain('🗣️ [MockTTS] Processing item', currentItem.id);

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
        logToMain('🗣️ [MockTTS] Finished item', currentItem.id);
        notifyClient(currentItem.client, 'end', { id: currentItem.id });
        currentItem = null;
        processNext();
        return;
    }

    const wordObj = words[currentWordIndex];
    const delay = BASE_MS_PER_WORD / currentItem.rate;

    timer = setTimeout(() => {
        // Emit boundary
        // logToMain(`%c 🗣️ [MockTTS]: "${wordObj.word}"`);

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
    logToMain(`🗣️ [MockTTS] notifyClient ${type}`, data);
    const msg = { type, ...data };
    if (client) {
        client.postMessage(msg);
    } else {
        logToMain('🗣️ [MockTTS] client missing, broadcasting');
        // Broadcast to all clients if source client is missing
        self.clients.matchAll().then(clients => {
            for (const c of clients) {
                c.postMessage(msg);
            }
        });
    }
}
