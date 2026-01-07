import type * as Y from 'yjs';

export abstract class BaseModel<T extends Y.AbstractType<any>> {
  public sharedType: T;

  constructor(sharedType: T) {
    this.sharedType = sharedType;
  }

  /**
   * Helper to ensure consistency in method signatures.
   * In Phase 1, this mostly just calls DBService.
   */
}
