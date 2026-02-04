import { describe, it, expect } from 'vitest';
import { computeDiff } from './JsonDiffViewer';

describe('computeDiff', () => {
  it('should detect added keys', () => {
    const oldVal = { a: 1 };
    const newVal = { a: 1, b: 2 };
    const result = computeDiff(oldVal, newVal);

    expect(result.type).toBe('modified');
    expect(result.children).toHaveLength(2);

    const addedNode = result.children!.find(c => c.key === 'b');
    expect(addedNode).toBeDefined();
    expect(addedNode!.type).toBe('added');
    expect(addedNode!.value).toBe(2);
  });

  it('should detect removed keys', () => {
    const oldVal = { a: 1, b: 2 };
    const newVal = { a: 1 };
    const result = computeDiff(oldVal, newVal);

    expect(result.children).toHaveLength(2);

    const removedNode = result.children!.find(c => c.key === 'b');
    expect(removedNode).toBeDefined();
    expect(removedNode!.type).toBe('removed');
    expect(removedNode!.value).toBe(2);
  });

  it('should detect modified values', () => {
    const oldVal = { a: 1 };
    const newVal = { a: 2 };
    const result = computeDiff(oldVal, newVal);

    const modifiedNode = result.children!.find(c => c.key === 'a');
    expect(modifiedNode).toBeDefined();
    expect(modifiedNode!.type).toBe('modified');
    expect(modifiedNode!.oldValue).toBe(1);
    expect(modifiedNode!.newValue).toBe(2);
  });

  it('should recurse into nested objects', () => {
    const oldVal = { a: { x: 1, y: 1 } };
    const newVal = { a: { x: 1, y: 2 } };
    const result = computeDiff(oldVal, newVal);

    const parentNode = result.children!.find(c => c.key === 'a');
    expect(parentNode!.type).toBe('modified');
    expect(parentNode!.children).toBeDefined();

    const childDiff = parentNode!.children!.find(c => c.key === 'y');
    expect(childDiff!.type).toBe('modified');
    expect(childDiff!.oldValue).toBe(1);
    expect(childDiff!.newValue).toBe(2);
  });

  it('should handle array changes', () => {
    const oldVal = [1, 2, 3];
    const newVal = [1, 2, 4];
    const result = computeDiff(oldVal, newVal);

    // Arrays are treated as objects with numeric keys
    expect(result.children).toHaveLength(3);
    const changedIndex = result.children!.find(c => c.key === '2');
    expect(changedIndex!.type).toBe('modified');
    expect(changedIndex!.oldValue).toBe(3);
    expect(changedIndex!.newValue).toBe(4);
  });

  it('should sort modified items first', () => {
      const oldVal = { a: 1, b: 2, c: 3 };
      const newVal = { a: 1, b: 4, c: 3 };
      const result = computeDiff(oldVal, newVal);

      // b is modified, a and c are unchanged
      // sort order: modified (0), added (1), removed (2), unchanged (3)

      expect(result.children![0].key).toBe('b');
      expect(result.children![1].type).toBe('unchanged');
      expect(result.children![2].type).toBe('unchanged');
  });
});
