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
