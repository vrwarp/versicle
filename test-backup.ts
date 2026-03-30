import { backupService } from './src/lib/BackupService';
import { useAnnotationStore } from './src/store/useAnnotationStore';
import { yjsPersistence, waitForYjsSync } from './src/store/yjs-provider';
import * as Y from 'yjs';
import 'fake-indexeddb/auto'; // Polyfill IndexedDB for Node.js

async function runTest() {
  console.log('1. Adding note');
  // Need to ensure Yjs is ready in Node
  await waitForYjsSync();
  
  const id = useAnnotationStore.getState().add({
    bookId: 'book1',
    cfiRange: 'epubcfi(/2/2/2)',
    text: 'test note text',
    type: 'note',
    color: '#ff0000',
    note: 'my user note'
  });
  console.log('Added note with id:', id);
  console.log('Current notes:', useAnnotationStore.getState().annotations);

  // Wait for persistence
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log('2. Generating backup');
  const manifest = await backupService.generateManifest();
  console.log('Manifest yjsSnapshot length:', manifest.yjsSnapshot.length);

  console.log('3. Simulating restore on a fresh device');
  
  // Clear the state
  useAnnotationStore.setState({ annotations: {} });
  if (yjsPersistence) {
    await yjsPersistence.clearData();
  }
  
  // Actually, restore uses processManifest
  await backupService.processManifest(manifest);

  // To simulate a reload, we should recreate the Y.Doc and store, but in this process
  // `versicle-yjs` DB was populated by `processManifest`.
  // Let's create a new Y.Doc and IndexeddbPersistence and see if it loads
  const newYDoc = new Y.Doc();
  const yIndexeddb = await import('y-indexeddb');
  const newPersistence = new yIndexeddb.IndexeddbPersistence('versicle-yjs', newYDoc);

  await new Promise(resolve => {
    newPersistence.once('synced', resolve);
  });

  const parsedAnnotations = newYDoc.getMap('annotations').toJSON();
  console.log('4. Restored Y.Doc annotations map:', parsedAnnotations);
}

runTest().catch(console.error);
