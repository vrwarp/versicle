# GitHub Configuration

This directory contains configuration files for GitHub-specific features, primarily GitHub Actions workflows used for Continuous Integration (CI).

## Contents

### `workflows/`

This directory stores the YAML definitions for GitHub Actions workflows.

*   **`visual-verification.yml`**:
    *   **Triggers**: On pull requests targeting the `main` branch.
    *   **Purpose**: Runs the visual verification suite to ensure no regressions are introduced.
    *   **Process**:
        1.  Sets up Node.js (v18) and Python (v3.10).
        2.  Installs frontend dependencies (`npm ci`) and Python dependencies (Playwright).
        3.  Builds the application (`npm run build`) and serves it (`npm run preview`).
        4.  Executes the verification script (`python verification/run_all.py`).
        5.  Uploads generated screenshots as build artifacts for review.
