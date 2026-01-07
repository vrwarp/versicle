import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { Annotation } from '../types/db';

export class AnnotationModel extends BaseModel {
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

export const annotationModel = new AnnotationModel();
