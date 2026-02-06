import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../lib/json-diff';
import { SeededRandom, DEFAULT_FUZZ_SEED, DEFAULT_FUZZ_ITERATIONS } from '../../test/fuzz-utils';

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

  describe('Fuzzing', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const createRandomJson = (rng: SeededRandom, depth: number = 0, maxDepth: number = 3): any => {
          if (depth >= maxDepth || rng.next() < 0.3) {
              // Return primitive
              const type = rng.nextInt(0, 3);
              switch (type) {
                  case 0: return rng.nextString(rng.nextInt(1, 10));
                  case 1: return rng.nextInt(0, 1000);
                  case 2: return rng.nextBool();
                  case 3: return null;
              }
          }

          if (rng.nextBool()) {
              // Array
              const len = rng.nextInt(0, 5);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const arr: any[] = [];
              for (let i = 0; i < len; i++) {
                  arr.push(createRandomJson(rng, depth + 1, maxDepth));
              }
              return arr;
          } else {
              // Object
              const numKeys = rng.nextInt(0, 5);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const obj: Record<string, any> = {};
              for (let i = 0; i < numKeys; i++) {
                  obj[rng.nextString(5)] = createRandomJson(rng, depth + 1, maxDepth);
              }
              return obj;
          }
      };

      it('should handle random inputs without crashing', () => {
          const rng = new SeededRandom(DEFAULT_FUZZ_SEED);

          for (let i = 0; i < DEFAULT_FUZZ_ITERATIONS; i++) {
              const oldVal = createRandomJson(rng);
              const newVal = createRandomJson(rng);

              try {
                  const result = computeDiff(oldVal, newVal);
                  expect(result).toBeDefined();
                  expect(result.type).toBeDefined();
                  expect(['added', 'removed', 'modified', 'unchanged']).toContain(result.type);

                  if (result.children) {
                      expect(Array.isArray(result.children)).toBe(true);
                  }
              } catch (e) {
                  console.error(`Fuzz crash on iteration ${i} (seed=${DEFAULT_FUZZ_SEED})`);
                  console.error('oldVal:', JSON.stringify(oldVal, null, 2));
                  console.error('newVal:', JSON.stringify(newVal, null, 2));
                  throw e;
              }
          }
      });
  });
});
