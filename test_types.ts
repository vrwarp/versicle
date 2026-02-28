import * as Y from 'yjs';

type StackItem = InstanceType<typeof Y.UndoManager>['undoStack'][number];

const x: StackItem = {} as any;
console.log('Type check passed if this compiles');
