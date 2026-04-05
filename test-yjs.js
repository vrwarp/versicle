import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import * as Y from 'yjs';

const doc = new Y.Doc();

const useStore = create()(yjs(doc, 'myStore', (set) => ({
  annotations: { '1': { text: 'hello' } },
  popover: { visible: false }
})));

// wait for yjs to sync it?
setTimeout(() => {
  console.log(doc.getMap('myStore').toJSON());
}, 100);
