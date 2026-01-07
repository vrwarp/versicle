import { dbService } from '../db/DBService';
import { BaseModel } from './BaseModel';
import type { ContentAnalysis } from '../types/db';
import type { ContentType } from '../types/content-analysis';

export class AnalysisModel extends BaseModel {
  async saveContentAnalysis(analysis: ContentAnalysis) {
    return dbService.saveContentAnalysis(analysis);
  }

  async getContentAnalysis(bookId: string, sectionId: string) {
    return dbService.getContentAnalysis(bookId, sectionId);
  }

  async saveContentClassifications(bookId: string, sectionId: string, classifications: { rootCfi: string; type: ContentType }[]) {
    return dbService.saveContentClassifications(bookId, sectionId, classifications);
  }

  async saveTableAdaptations(bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]) {
    return dbService.saveTableAdaptations(bookId, sectionId, adaptations);
  }

  async getBookAnalysis(bookId: string) {
    return dbService.getBookAnalysis(bookId);
  }

  async clearContentAnalysis() {
    return dbService.clearContentAnalysis();
  }
}

export const analysisModel = new AnalysisModel();
