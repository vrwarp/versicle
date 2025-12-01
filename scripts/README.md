# Utility Scripts

This directory contains Python scripts used for various development and maintenance tasks.

## Contents

*   **`generate_pwa_icons.py`**:
    *   **Purpose**: Programmatically generates placeholder PWA icons to satisfy manifest requirements without storing binary image files in the version control system.
    *   **Output**: Generates `public/pwa-192x192.png` and `public/pwa-512x512.png`.
    *   **Requirements**: Requires the `Pillow` library.
    *   **Design**: Draws a stylized "V" logo (for Versicle) using vector coordinates.
