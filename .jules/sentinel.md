## 2025-05-20 - API Key Exposure in URL
**Vulnerability:** Google Cloud TTS API keys were passed as query parameters in the URL (`?key=...`).
**Learning:** External API providers often support multiple authentication methods. Developers might choose the easiest one (URL param) without considering the security implications (leakage in logs, browser history).
**Prevention:** Always prefer `Authorization` headers or custom headers (like `X-Goog-Api-Key`) over URL parameters for sensitive secrets. Verify vendor documentation for secure authentication options.
