import * as Y from 'yjs';
import { yDoc } from '../../store/yjs-provider';

export class YjsMonitor {
    static getDocumentSize(): number {
        const stateVector = Y.encodeStateVector(yDoc);
        return stateVector.byteLength;
    }

    static getUpdateSize(): number {
        const update = Y.encodeStateAsUpdate(yDoc);
        return update.byteLength;
    }

    static getStats() {
        return {
            inventoryCount: yDoc.getMap('inventory').size,
            progressCount: yDoc.getMap('progress').size,
            annotationsCount: yDoc.getMap('annotations').size,
            readingListCount: yDoc.getMap('reading_list').size,
            docSizeBytes: this.getUpdateSize(),
        };
    }

    static logStats() {
        console.table(this.getStats());
    }
}
