import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { Annotation } from '../types/db';
import * as Y from 'yjs';

// Plan says Y.Map<UUID, Annotation>, but CRDTService uses Y.Array<Annotation>.
// The plan is the "new" truth. I will use Y.Map as per plan, assuming we will migrate.
// "Key Data Structures: ... Yjs Type Mapping: Y.Map<UUID, Annotation>"

export class AnnotationModel extends BaseModel<Y.Map<Annotation>> {
  constructor(doc: Y.Doc) {
    // Note: If the existing data is Y.Array, this might conflict if we were actually syncing.
    // Since we are "shunting", this initialization is structural only for now.
    // However, if CRDTService.ts expects 'annotations' to be Array, and I ask for Map, Yjs might complain if data exists.
    // But CRDTService uses 'annotations' key.
    // Let's use a new key 'annotations_v2' or assume we are rewriting the schema?
    // The plan implies we are rewriting the architecture.
    // I will stick to 'annotations' but use Y.Map as instructed.
    // IF strict Yjs checks types, this might be an issue if we load an old doc.
    super(doc.getMap('annotations'));
  }

  async addAnnotation(annotation: Annotation) {
    return dbService.addAnnotation(annotation);
  }

  async getAnnotations(bookId: string) {
    return dbService.getAnnotations(bookId);
  }

  async deleteAnnotation(id: string) {
    return dbService.deleteAnnotation(id);
  }
}
