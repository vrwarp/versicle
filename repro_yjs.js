const Y = require('yjs');

const doc = new Y.Doc();
const map = doc.getMap('test');

// 1. Initial State
map.set('key', 'original');
console.log('Step 1: ', map.toJSON());

// 2. Create Checkpoint (Snapshot)
const snapshot = Y.encodeStateAsUpdate(doc);

// 3. Delete item (simulate user action or "wipe" logic)
map.delete('key');
console.log('Step 3: ', map.toJSON());

// 4. Restore Logic (Current Implementation)
doc.transact(() => {
    // Wipe existing (already wiped in step 3, but let's be sure)
    Array.from(map.keys()).forEach(k => map.delete(k));

    // Apply Snapshot
    Y.applyUpdate(doc, snapshot);
}, 'restore-checkpoint');

console.log('Step 4 (After Restore): ', map.toJSON());

if (map.get('key') === 'original') {
    console.log('SUCCESS: Restored');
} else {
    console.log('FAILURE: Data Loss');
}
