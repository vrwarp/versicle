export type DiffType = 'added' | 'removed' | 'modified' | 'unchanged';

export interface DiffNode {
  key: string;
  type: DiffType;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oldValue?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  newValue?: any;
  children?: DiffNode[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const computeDiff = (oldVal: any, newVal: any, key: string = 'root'): DiffNode => {
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
  const keys = new Set([...Object.keys(oldVal), ...Object.keys(newVal)]);
  const children: DiffNode[] = [];

  for (const k of keys) {
    const oldV = oldVal[k];
    const newV = newVal[k];

    if (oldV === undefined) {
      children.push({ key: k, type: 'added', value: newV });
    } else if (newV === undefined) {
      children.push({ key: k, type: 'removed', value: oldV });
    } else if (JSON.stringify(oldV) !== JSON.stringify(newV)) {
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
