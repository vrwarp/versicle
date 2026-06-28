import { test, expect } from './utils';

/**
 * Regression guard for the dictionary import failure:
 *
 *   [DictionaryService] Dictionary import failed
 *   SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON
 *
 * Root cause: the compiled CC-CEDICT artifact (public/dict/cedict.json) is
 * git-ignored — it is built by `npm run compile-dict`, in CI, and the Docker
 * images. When it is absent, both the Vite dev server and GitHub Pages' 404.html
 * serve the app's index.html with a 200, so DictionaryService's `response.ok`
 * check passes and the subsequent JSON.parse dies on "<!doctype html>".
 *
 * This test asserts the asset is actually served as JSON (not the app shell) and
 * that the DictionaryService can import it end-to-end, so a build that ships
 * without the dictionary fails here instead of silently in front of a reader.
 */
test('dictionary artifact is served as JSON, not the SPA shell', async ({ page }) => {
  await page.goto('/');

  const probe = await page.evaluate(async () => {
    const res = await fetch('/dict/cedict.json');
    const contentType = res.headers.get('content-type') ?? '';
    // Read just the head — the real artifact is ~15 MB; we only need to prove
    // it is JSON, not "<!doctype html>".
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      contentType,
      head: text.slice(0, 64),
      length: text.length,
    };
  });

  expect(probe.ok, `GET /dict/cedict.json -> ${probe.status}`).toBeTruthy();
  expect(
    probe.contentType,
    `content-type was "${probe.contentType}" (the app shell?) — run \`npm run compile-dict\``,
  ).toContain('json');
  expect(
    probe.head.toLowerCase(),
    `body started with the HTML app shell: ${probe.head}`,
  ).not.toContain('<!doctype');
  expect(probe.head.trimStart().startsWith('{')).toBeTruthy();
  // A real compiled dictionary is megabytes, not the few-KB shell.
  expect(probe.length).toBeGreaterThan(100_000);
});

test('dictionary artifact parses to real CC-CEDICT entries the service can consume', async ({ page }) => {
  // The asset probe above stops at the head of the file; this parses the whole
  // artifact exactly as DictionaryService does (`(await response.json()) as
  // Record<string, DictEntryTuple>`) and asserts it is a real, non-trivial
  // dictionary — not the 11-entry mock and not a truncated export. Runs over
  // fetch so it holds against both the dev server and the built preview the
  // Docker harness serves (npm run preview); a `/src/**` import would not.
  await page.goto('/');

  const parsed = await page.evaluate(async () => {
    const res = await fetch('/dict/cedict.json');
    if (!res.headers.get('content-type')?.includes('json')) {
      return { ok: false, contentType: res.headers.get('content-type') };
    }
    const data = (await res.json()) as Record<string, [string, string]>;
    const wo = data['我']; // a stable, ubiquitous CC-CEDICT headword
    return { ok: true, keyCount: Object.keys(data).length, wo };
  });

  expect(parsed.ok, `content-type was "${parsed.contentType}"`).toBeTruthy();
  // The compiler refuses to ship fewer than 10k entries; the mock fixture is 11.
  expect(parsed.keyCount).toBeGreaterThan(10_000);
  // [pinyin, definitions] tuple shape — what getEntry/getEntries return. The
  // compiled artifact keeps CC-CEDICT's numbered pinyin ("wo3"); accent
  // conversion is a display concern, so assert on the raw stored form.
  expect(Array.isArray(parsed.wo)).toBeTruthy();
  expect(parsed.wo?.[0]).toMatch(/wo3/i);
  expect(parsed.wo?.[1]).toMatch(/\bme\b/i);
});
