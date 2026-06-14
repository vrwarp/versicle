<!-- GENERATED FILE — do not edit by hand. -->
<!-- Rendered by src/app/docs/registryDocs.ts from the live registries. -->
<!-- Drift-gated by src/app/docs/docs.test.ts: a plain `npm test` fails when -->
<!-- this file disagrees with the registries. Regenerate: npm run docs:generate -->

# Kernel (L0)

The bottom layer. **`kernel/` imports nothing internal** except
`~types` — enforced at error by the dependency-cruiser
`kernel-imports-nothing` rule (0 violations). Admission requires zero
internal dependencies AND at least two consuming domains (the
anti-junk-drawer rule, C12); additions are reviewed against that rule and
recorded here by regeneration.

| Module | Contents |
| --- | --- |
| `cfi/` | canonical CFI algebra — parse, contains, group, merge, locale-aware sentence snap |
| `diagnostics/` | flight-recorder ring-buffer core (namespaced buffers per subsystem) |
| `locale/` | typed MessageKey catalog, cached Intl formatters, LiveAnnouncer, uiLocale |
| `net/` | NetworkGateway + egress destination registry + generated-CSP renderer |

## The egress destination registry (C9)

`net/destinations.ts` is the single source of truth for what hosts this
app may contact. `NetworkGateway.egress(destinationId, …)` checks every
production fetch against it (raw fetch is lint-banned outside
`src/kernel/net/`), and the CSP is GENERATED from it
(`npm run generate:csp`; `net/csp.test.ts` pins registry==CSP).

| Id | Hosts | Via | Data class | Consent |
| --- | --- | --- | --- | --- |
| `gemini` | generativelanguage.googleapis.com | gateway | book-content | per-book |
| `google-tts` | texttospeech.googleapis.com | gateway | book-content | provider-selection |
| `openai-tts` | api.openai.com | gateway | book-content | provider-selection |
| `lemonfox-tts` | api.lemonfox.ai | gateway | book-content | provider-selection |
| `hf-piper-catalog` | huggingface.co | gateway | metadata | provider-selection |
| `hf-piper-models` | huggingface.co, cdn-lfs.huggingface.co, cdn-lfs-us-1.huggingface.co | gateway | binary-asset | provider-selection |
| `drive` | www.googleapis.com | gateway | binary-asset | oauth |
| `google-oauth` | accounts.google.com | sdk | auth | oauth |
| `firebase` | firestore.googleapis.com, identitytoolkit.googleapis.com, securetoken.googleapis.com, www.googleapis.com, firebasestorage.googleapis.com, *.firebaseio.com | sdk | book-derived | oauth |

Full per-destination detail (timeouts, offline policy, purpose strings)
lives in the registry module itself and in `architecture.md` §6.
