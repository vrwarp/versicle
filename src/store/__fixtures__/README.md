# tts-storage localStorage fixtures

Captured persistence blobs for the `useTTSStore` `persist` slice (`localStorage['tts-storage']`),
per `plan/overhaul/prep/phase5-tts-strangler.md` §5b.4 step 3 (the fixture comes FIRST — these
exist *before* any 5b split code, and gate the `tts-storage` v3 → `tts-settings` v1 migration
in 5b-PR5).

| file | era | provenance |
|---|---|---|
| `tts-storage.v3.json` | legacy-current (version 3) | **Captured from the live pre-split store** under vitest-jsdom by `scripts/capture-tts-storage.ts` at the gate PR (drove `setApiKey`/`setProviderId('piper')`/voice profiles/zh `{rate:1.25, minSentenceLength:6}`/custom abbreviations, then dumped the blob). Re-serialized pretty for review; content verbatim. The capture script and the store it drove were DELETED at 5b-PR3 (the split) — the fixture is frozen. |
| `tts-storage.v2.json` | version 2 | **Hand-derived** from the legacy migration chain (`useTTSStore` persist `migrate`): profiles exist but lack `minSentenceLength` (backfilled by the `version < 3` step). |
| `tts-storage.v1.json` | version 1 | **Hand-derived**: flat pre-profiles era (`rate`/`pitch`/`voice`/`minSentenceLength` at top level; no `activeLanguage`/`profiles` — folded by the `version < 2` step). |

All three are CHECKED IN AND REVIEWED artifacts — never regenerated in CI.
`ttsStorageFixtures.test.ts` is the 5b-PR3 migration ACCEPTANCE suite against them:
legacy chain (v1→v2→v3) + split mapping (→ `tts-settings` v1) — API keys survive,
profiles survive incl. zh `minSentenceLength`, `providerId: 'local'` maps per platform
(webspeech/capacitor), dropped fields are absent (`enableCostWarning`, the flat
`rate`/`pitch`/`voice`/`minSentenceLength` mirrors, profile `pitch`/`volume`), and the
legacy `tts-storage` key is retained for one release (rollback path; P9 removes it).
The API keys are obviously-fake placeholder strings.
