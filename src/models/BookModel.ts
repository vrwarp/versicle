import { BaseModel } from './BaseModel';
import * as Y from 'yjs';
import type { BookMetadata } from '../types/db';
import type { NavigationItem } from 'epubjs';

export class BookModel extends BaseModel<Y.Map<any>> implements BookMetadata {
  constructor(data: Y.Map<any> | BookMetadata) {
    if (data instanceof Y.Map) {
      super(data);
    } else {
      const map = new Y.Map();
      for (const [key, value] of Object.entries(data)) {
        map.set(key, value);
      }
      super(map);
    }
  }

  get id(): string { return this.y.get('id'); }
  set id(v: string) { this.y.set('id', v); }

  get title(): string { return this.y.get('title'); }
  set title(v: string) { this.y.set('title', v); }

  get author(): string { return this.y.get('author'); }
  set author(v: string) { this.y.set('author', v); }

  get description(): string | undefined { return this.y.get('description'); }
  set description(v: string | undefined) { this.y.set('description', v); }

  get coverUrl(): string | undefined { return this.y.get('coverUrl'); }
  set coverUrl(v: string | undefined) { this.y.set('coverUrl', v); }

  get coverBlob(): Blob | undefined { return this.y.get('coverBlob'); }
  set coverBlob(v: Blob | undefined) { this.y.set('coverBlob', v); }

  get addedAt(): number { return this.y.get('addedAt'); }
  set addedAt(v: number) { this.y.set('addedAt', v); }

  get progress(): number { return this.y.get('progress') || 0; }
  set progress(v: number) { this.y.set('progress', v); }

  get currentCfi(): string | undefined { return this.y.get('currentCfi'); }
  set currentCfi(v: string | undefined) { this.y.set('currentCfi', v); }

  get lastRead(): number | undefined { return this.y.get('lastRead'); }
  set lastRead(v: number | undefined) { this.y.set('lastRead', v); }

  get totalDuration(): number { return this.y.get('totalDuration') || 0; }
  set totalDuration(v: number) { this.y.set('totalDuration', v); }

  get isAnalysisEnabled(): boolean { return this.y.get('isAnalysisEnabled') || false; }
  set isAnalysisEnabled(v: boolean) { this.y.set('isAnalysisEnabled', v); }

  get isTableAdaptationEnabled(): boolean { return this.y.get('isTableAdaptationEnabled') || false; }
  set isTableAdaptationEnabled(v: boolean) { this.y.set('isTableAdaptationEnabled', v); }

  get isOffloaded(): boolean { return this.y.get('isOffloaded') || false; }
  set isOffloaded(v: boolean) { this.y.set('isOffloaded', v); }

  get filename(): string | undefined { return this.y.get('filename'); }
  set filename(v: string | undefined) { this.y.set('filename', v); }

  get fileHash(): string | undefined { return this.y.get('fileHash'); }
  set fileHash(v: string | undefined) { this.y.set('fileHash', v); }

  get lastPlayedCfi(): string | undefined { return this.y.get('lastPlayedCfi'); }
  set lastPlayedCfi(v: string | undefined) { this.y.set('lastPlayedCfi', v); }

  get lastPauseTime(): number | undefined { return this.y.get('lastPauseTime'); }
  set lastPauseTime(v: number | undefined) { this.y.set('lastPauseTime', v); }

  get syntheticToc(): NavigationItem[] | undefined { return this.y.get('syntheticToc'); }
  set syntheticToc(v: NavigationItem[] | undefined) { this.y.set('syntheticToc', v); }

  get fileSize(): number | undefined { return this.y.get('fileSize'); }
  set fileSize(v: number | undefined) { this.y.set('fileSize', v); }

  get totalChars(): number | undefined { return this.y.get('totalChars'); }
  set totalChars(v: number | undefined) { this.y.set('totalChars', v); }

  get aiAnalysisStatus(): 'none' | 'partial' | 'complete' | undefined { return this.y.get('aiAnalysisStatus'); }
  set aiAnalysisStatus(v: 'none' | 'partial' | 'complete' | undefined) { this.y.set('aiAnalysisStatus', v); }

  get version(): number | undefined { return this.y.get('version'); }
  set version(v: number | undefined) { this.y.set('version', v); }

  toJSON(): BookMetadata {
    return this.y.toJSON() as BookMetadata;
  }
}
