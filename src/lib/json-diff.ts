type DiffType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface DiffNode {
  key: string;
  type: DiffType;
  value?: unknown;
  oldValue?: unknown;
  newValue?: unknown;
  children?: DiffNode[];
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object' || a === null || b === null) return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  const keysA = Object.keys(recA);
  const keysB = Object.keys(recB);
  if (keysA.length !== keysB.length) return false;

  for (let i = 0; i < keysA.length; i++) {
    const k = keysA[i];
    if (!Object.prototype.hasOwnProperty.call(recB, k)) return false;
    if (!isDeepEqual(recA[k], recB[k])) return false;
  }
  return true;
}

export const computeDiff = (oldVal: unknown, newVal: unknown, key: string = 'root'): DiffNode => {
  if (oldVal === newVal) {
    return { key, type: 'unchanged', value: oldVal };
  }

  const isOldObj = typeof oldVal === 'object' && oldVal !== null;
  const isNewObj = typeof newVal === 'object' && newVal !== null;

  if (!isOldObj && !isNewObj) {
    // Both primitives, and different
    return { key, type: 'modified', oldValue: oldVal, newValue: newVal };
  }

  if (isOldObj !== isNewObj) {
     // One is object, other is not -> treated as full modification
     return { key, type: 'modified', oldValue: oldVal, newValue: newVal };
  }

  // Both are objects/arrays
  const oldRec = oldVal as Record<string, unknown>;
  const newRec = newVal as Record<string, unknown>;
  const keys = new Set([...Object.keys(oldRec), ...Object.keys(newRec)]);
  const children: DiffNode[] = [];

  for (const k of keys) {
    const oldV = oldRec[k];
    const newV = newRec[k];

    if (oldV === undefined) {
      children.push({ key: k, type: 'added', value: newV });
    } else if (newV === undefined) {
      children.push({ key: k, type: 'removed', value: oldV });
    } else if (!isDeepEqual(oldV, newV)) {
        // Only recurse if different
        children.push(computeDiff(oldV, newV, k));
    } else {
        // Unchanged
        children.push({ key: k, type: 'unchanged', value: oldV });
    }
  }

  // Sort children: modified/added/removed first, then unchanged. Within groups, alphabetical.
  children.sort((a, b) => {
      const score = (node: DiffNode) => {
          if (node.type === 'modified') return 0;
          if (node.type === 'added') return 1;
          if (node.type === 'removed') return 2;
          return 3;
      };
      const scoreA = score(a);
      const scoreB = score(b);
      if (scoreA !== scoreB) return scoreA - scoreB;
      return a.key.localeCompare(b.key);
  });

  return { key, type: 'modified', children, oldValue: oldVal, newValue: newVal };
};
