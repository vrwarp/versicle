# Architectural White Paper: Refactoring `useAllBooks` for React Predictability

## Executive Summary
The Versicle library implements a `useAllBooks` selector in `src/store/selectors.ts` that acts as the central ingestion point for displaying the user's book library. This selector performs a complex two-phase merge:
1.  **Phase 1 (Base Books):** Merging raw inventory (`useBookStore`) with static metadata (covers, offloaded status from `useLibraryStore`).
2.  **Phase 2 (Progress Merge):** Merging the resulting base books with highly volatile progress data (`useReadingStateStore`) and reading lists (`useReadingListStore`).

Historically, the application attempted to enforce **strict referential stability** for individual book objects within this selector. The goal was to ensure that if Book A's reading progress updated, the object reference for Book B remained unchanged (`Object.is(oldB, newB) === true`), preventing downstream React components from re-rendering Book B.

To achieve this, the previous implementation utilized a manual `useRef` caching pattern alongside a `WeakMap`. However, this implementation violated React's strict mode rules and the newly enforced `react-hooks/refs` linting rule by directly reading and writing to `ref.current` *during the render phase*.

This white paper outlines the decision to prioritize **React Predictability** over manual referential stability optimizations by refactoring `useAllBooks` to utilize pure `useMemo` derivations.

---

## The Problem: Impure Renders and React's Ref Rules

React strictly enforces that the render phase must be **pure and deterministic**. A component or hook should only calculate its next state based on its inputs (props, state, context) and return the corresponding UI or derived data.

### The Anti-Pattern
The previous implementation of `useAllBooks` attempted to bypass React's rendering lifecycle by maintaining a manual cache:

```typescript
// Anti-pattern: Mutating refs and reading refs during render
const previousResultsRef = useRef({});
const lastPhase2DepsRef = useRef({ baseBooks: null, progressMap: null });

// ... inside render body ...
const needsRebuild = lastPhase2DepsRef.current.progressMap !== progressMap; // ERROR: Cannot read ref during render

if (needsRebuild) {
    // ... compute new books ...
    previousResultsRef.current = newCache; // ERROR: Cannot write ref during render
}
```

This approach violates the `react-hooks/refs` rule. As the React documentation states:
> "React refs are values that are not needed for rendering. Refs should only be accessed outside of render, such as in event handlers or effects. Accessing a ref value (the `current` property) during render can cause your component not to update as expected."

If React runs in Concurrent Mode or Strict Mode, it may call the render function multiple times before committing. If a ref is mutated during an aborted render pass, the cache becomes corrupted and out of sync with the committed state, leading to subtle, irreproducible bugs ("tearing").

---

## The Trade-off: Referential Stability vs. Predictability

The core challenge in refactoring `useAllBooks` is choosing between two competing priorities:

1.  **Maintain Strict Referential Equality (The Old Way):** If Book A changes, Book B's object reference must remain identical. This requires a manual cache. However, implementing a manual cache *safely* requires moving the cache updates to a `useLayoutEffect`. Unfortunately, reading from that cache to compute the *current* render's output becomes impossible without triggering cascading re-renders (state updates) or falling back to reading refs during render (which is forbidden).
2.  **Embrace React Predictability (The Pure `useMemo` Way):** We compute the derived book list purely within `useMemo` dependencies. If `progressMap` changes (because the user turned a page in Book A), the entire `useMemo` block re-executes, generating *new* object references for *all* books, including Book B.

### The Decision
We have decided to proceed with **Option 2: Embrace React Predictability via Pure `useMemo`**.

**Why?**
1.  **Rule Adherence:** The application's architectural directives strictly mandate obeying the `react-hooks/refs` rule and avoiding anti-patterns.
2.  **Cache Drops are Acceptable:** React explicitly states that `useMemo` is a *performance optimization, not a semantic guarantee*. It may choose to "forget" memoized values to free memory. If the application's correctness relies on `useMemo` never dropping, it is fundamentally flawed.
3.  **Component-Level Bailing is Sufficient:** While `useAllBooks` will now return new object references for *all* books when *one* book's progress updates, this does not necessarily mean the entire UI must re-render expensively. We can rely on `React.memo` or Zustand's fine-grained selectors at the component level to bail out of rendering if the *values* within the object haven't changed.

---

## The Solution: Pure `useMemo` Derivations

The refactored `useAllBooks` selector removes all `useRef` and `WeakMap` mutations from the render phase.

### Phase 1 Refactor
Phase 1 previously mutated a `WeakMap` cached in a ref. It has been rewritten to instantiate the derived list entirely within a pure `useMemo` block. This block only depends on rarely changing data (`books`, `staticMetadata`, `offloadedBookIds`).

```typescript
const baseBooks = useMemo(() => {
    // Pure derivation logic...
    return result.sort((a, b) => b.lastInteraction - a.lastInteraction);
}, [books, staticMetadata, offloadedBookIds]);
```

### Phase 2 Refactor
Phase 2 previously used a complex `useRef` cache to manually enforce `Object.is` equality for individual books. It has been entirely replaced with a standard map operation inside `useMemo`.

```typescript
const finalBooks = useMemo(() => {
    const currentDeviceId = getDeviceId();
    const result = [];

    for (let i = 0; i < baseBooks.length; i++) {
        // Pure mapping logic... merging baseBooks[i] with progressMap[baseBooks[i].id]
        result.push(newBook);
    }

    return result;
}, [baseBooks, progressMap, readingListEntries, readingListMatchMap]);
```

---

## Testing Implications

Because we have prioritized pure React predictability over manual referential stability, the unit test suite for `selectors.ts` will fail where it explicitly asserts `expect(bookB_v2).toBe(bookB_v1)`.

When `progressMap` updates (e.g., Book A's progress changes from 10% to 20%), the `finalBooks` `useMemo` block will re-execute because `progressMap` is a dependency. Consequently, it will generate a structurally identical but *referentially new* object for Book B.

The tests must be updated to reflect this architectural shift. Instead of asserting strict identity (`.toBe`), the tests should assert value equality (`.toStrictEqual`) or explicitly verify that the progress *values* behaved correctly (e.g., Book B remained at 0% while Book A increased to 20%).

## Conclusion
By refactoring `useAllBooks` to use pure `useMemo` derivations, we eliminate a critical class of unpredictable render-phase mutations. While we trade away some aggressive memoization of individual array elements, we guarantee adherence to React's concurrent mode contracts and establish a much more robust, debuggable global state selector.