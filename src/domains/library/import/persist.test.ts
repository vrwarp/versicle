/**
 * Pure retarget pin — absorbs BookImportService.test.ts's import-with-id
 * assertions (ledger row 10): EVERY bookId-bearing row is rewritten when an
 * extraction is grafted onto an existing id (ghost adoption / replace /
 * synced-book restore).
 */
import { describe, it, expect } from 'vitest';
import { retargetExtraction } from './persist';
import { makeFullExtraction } from '@test/harness';

describe('retargetExtraction', () => {
  it('regression: import-with-id rewrites every bookId-bearing row (absorbed from BookImportService.test.ts)', () => {
    const original = makeFullExtraction({ bookId: 'fresh-uuid' });
    const retargeted = retargetExtraction(original, 'existing-id');

    expect(retargeted.bookId).toBe('existing-id');
    expect(retargeted.manifest.bookId).toBe('existing-id');
    expect(retargeted.resource.bookId).toBe('existing-id');
    expect(retargeted.structure.bookId).toBe('existing-id');
    expect(retargeted.inventory.bookId).toBe('existing-id');
    expect(retargeted.progress.bookId).toBe('existing-id');
    expect(retargeted.overrides.bookId).toBe('existing-id');

    for (const section of retargeted.sections) {
      expect(section.bookId).toBe('existing-id');
      expect(section.id).not.toContain('fresh-uuid');
    }
    for (const batch of retargeted.ttsContentBatches) {
      expect(batch.bookId).toBe('existing-id');
      expect(batch.id).not.toContain('fresh-uuid');
    }
    for (const table of retargeted.tableBatches) {
      expect(table.bookId).toBe('existing-id');
      expect(table.id).not.toContain('fresh-uuid');
    }

    // The original is untouched (pure).
    expect(original.bookId).toBe('fresh-uuid');
    expect(original.manifest.bookId).toBe('fresh-uuid');
  });

  it('is the identity when the target id matches', () => {
    const extraction = makeFullExtraction({ bookId: 'same-id' });
    expect(retargetExtraction(extraction, 'same-id')).toBe(extraction);
  });
});
