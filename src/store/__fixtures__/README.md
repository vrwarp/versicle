# tts-storage localStorage fixtures

Captured persistence blobs for the `useTTSStore` `persist` slice (`localStorage['tts-storage']`),
per `plan/overhaul/prep/phase5-tts-strangler.md` §5b.4 step 3 (the fixture comes FIRST — these
exist *before* any 5b split code, and gate the `tts-storage` v3 → `tts-settings` v1 migration
in 5b-PR5).

| file | era | provenance |
|---|---|---|
| `tts-storage.v3.json` | current (version 3) | **Captured from the live store** under vitest-jsdom by `node scripts/capture-tts-storage.ts` (drives `setApiKey`/`setProviderId('piper')`/voice profiles/zh `{rate:1.25, minSentenceLength:6}`/custom abbreviations, then dumps the blob). Re-serialized pretty for review; content verbatim. |
| `tts-storage.v2.json` | version 2 | **Hand-derived** from the legacy migration chain (`useTTSStore` persist `migrate`): profiles exist but lack `minSentenceLength` (backfilled by the `version < 3` step). |
| `tts-storage.v1.json` | version 1 | **Hand-derived**: flat pre-profiles era (`rate`/`pitch`/`voice`/`minSentenceLength` at top level; no `activeLanguage`/`profiles` — folded by the `version < 2` step). |

All three are CHECKED IN AND REVIEWED artifacts — never regenerated in CI.
`ttsStorageFixtures.test.ts` pins the migration chain against them (API keys survive,
profiles survive incl. zh `minSentenceLength`, the `tts-storage` key is never deleted).
The API keys are obviously-fake placeholder strings.

5b-PR5 extends the same fixtures with: `providerId: 'local'` → per-platform mapping,
dropped-field assertions (`enableCostWarning`, profile `pitch`/`volume`), `tts-settings` v1
shape, and `tts-storage` retention for one release (rollback path; P9 removes it).
