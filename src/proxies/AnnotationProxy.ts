import { dbService } from '../db/DBService';
import { AnnotationModel } from '../models/AnnotationModel';
import type { Annotation } from '../types/db';

export class AnnotationProxy {
  async addAnnotation(annotation: Annotation | AnnotationModel) {
    const data = annotation instanceof AnnotationModel ? annotation.toJSON() : annotation;
    return dbService.addAnnotation(data);
  }

  async getAnnotations(bookId: string) {
    const annotations = await dbService.getAnnotations(bookId);
    return annotations.map(a => new AnnotationModel(a));
  }

  async deleteAnnotation(id: string) {
    return dbService.deleteAnnotation(id);
  }
}
