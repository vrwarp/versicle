let state = 0;

function processBatch() {
    state = 1;
    console.log("processBatch executed, state:", state);
}

function onLoaded() {
    // 1. If we use single queueMicrotask
    // queueMicrotask(() => {
    //     console.log("migration executed, state:", state);
    // });

    // 2. If we use double queueMicrotask
    queueMicrotask(() => {
        queueMicrotask(() => {
            console.log("migration executed, state:", state);
        });
    });
}

// Simulating zustand-middleware-yjs observeDeep callback
console.log("Transaction start");
onLoaded();
queueMicrotask(processBatch);
console.log("Transaction end");
