import time
from playwright.sync_api import sync_playwright

def verify_empty_library_loading():
    with sync_playwright() as p:
        # Pass service_workers="block" and ignore_https_errors to bypass hang from database initialization via SW
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(ignore_https_errors=True, service_workers="block")
        page = context.new_page()

        # Inject script to suppress unhandled rejection loop from SW block
        page.add_init_script("window.addEventListener('unhandledrejection', e => { if (e.reason && e.reason.name === 'SecurityError') e.preventDefault(); })")

        print("Navigating to local dev server...")
        page.goto("https://localhost:5173")

        print("Waiting for page load...")
        page.wait_for_timeout(5000)

        # Take a screenshot to see what's currently rendered
        page.screenshot(path="verification_debug.png")
        print("Screenshot saved to verification_debug.png")

        browser.close()

if __name__ == "__main__":
    verify_empty_library_loading()
