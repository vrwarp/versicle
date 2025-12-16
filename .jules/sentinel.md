## 2025-05-20 - API Key Exposure in URL
**Vulnerability:** Google Cloud TTS API keys were passed as query parameters in the URL (`?key=...`).
**Learning:** External API providers often support multiple authentication methods. Developers might choose the easiest one (URL param) without considering the security implications (leakage in logs, browser history).
**Prevention:** Always prefer `Authorization` headers or custom headers (like `X-Goog-Api-Key`) over URL parameters for sensitive secrets. Verify vendor documentation for secure authentication options.

## 2024-05-23 - Unvalidated Backup Restoration
**Vulnerability:** The `BackupService` blindly trusted the contents of `manifest.json` from imported backups, allowing invalid or malformed data to be written to the database.
**Learning:** Even "local" data sources like backups should be treated as untrusted input. Users (or attackers) can modify these files. Relying on downstream validation (at read time) leaves "ghost" data in the database.
**Prevention:** Implement strict schema validation and sanitization at the ingestion point (import/restore). Use "Repair or Reject" strategies to handle legacy data gracefully while maintaining security.

## 2025-05-21 - Input Length Limits for DoS Prevention
**Vulnerability:** Unbounded string inputs in metadata (e.g., Book Description) could potentially cause memory exhaustion or UI performance issues (DoS) if malicious files are imported.
**Learning:** Frontend applications processing local files often neglect input limits, assuming local data is safe. However, files can be crafted maliciously.
**Prevention:** Enforce strict character limits on all user-supplied content during ingestion, even for "harmless" fields like titles or descriptions.

## 2025-05-25 - Rejected: Enforced Metadata Sanitization
**Constraint:** A proposal to automatically enforce metadata limits (removing user bypass) was rejected to preserve user control over "Import As-Is".
**Learning:** Security controls that impact user experience or legacy use-cases ("I want my long title") may be rejected even if they close a vulnerability.
**Prevention:** When a security control must be bypassable, ensure the risk is documented and the user is explicitly warned (e.g., "Not Recommended"). In this case, the vulnerability (DoS via massive metadata) persists if the user chooses to ignore the warning.

## 2025-05-26 - Metadata XSS Sanitization
**Vulnerability:** Stored XSS potential in book metadata fields (Title, Author, Description) if rendered unsafely.
**Learning:** While React escapes content by default, sanitizing input at ingestion provides defense-in-depth and protects against future unsafe usage (e.g. `dangerouslySetInnerHTML`).
**Prevention:** Implemented HTML tag stripping in `sanitizeString`. Use regex `/<[a-zA-Z\/][^>]*>/gm` to avoid stripping math symbols (`A < B`).

## 2025-12-16 - [Fragile Regex Sanitization Revisited]
**Vulnerability:** The previously implemented regex-based sanitization for book metadata (`<[a-zA-Z/][^>]*>`) was bypassed by nested tags (e.g., `<<script>script>`) and attribute values containing `>`.
**Learning:** Security fixes based on "clever regex" often introduce new edge cases. Trying to preserve "math symbols" by guessing HTML syntax via regex is fragile.
**Prevention:** Replaced regex with `DOMParser` to leverage the browser's native HTML parsing capability, which robustly handles entities, attributes, and nesting while still allowing plain text (like `A < B`).
