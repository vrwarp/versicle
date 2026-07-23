#!/bin/bash
set -e
mkdir -p /home/jules/verification

cat << 'PY' > /home/jules/verification/verify.py
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(ignore_https_errors=True)
    page = context.new_page()

    # Wait for the Vite dev server to be ready
    # It uses HTTPS!
    page.goto('https://localhost:5173')

    # Wait for app to load completely
    page.wait_for_selector('input[type="search"]')

    # We want to verify tooltips on icon buttons. We can just take a screenshot of the library view
    # But tooltips only appear on hover, so let's hover the search clear button.
    # We need to trigger the search input first to make the clear button appear.
    page.locator('input[type="search"]').fill("test")

    # Wait for the clear button to appear (it should have our new title="Clear search" and aria-label="Clear search")
    clear_btn = page.get_by_label("Clear search")
    clear_btn.wait_for(state="visible")

    # Hover over it to potentially trigger the native tooltip (though Playwright screenshot doesn't capture native OS tooltips,
    # we can at least assert the attribute is there)
    assert clear_btn.get_attribute("title") == "Clear search"
    assert clear_btn.get_attribute("aria-label") == "Clear search"

    clear_btn.hover()

    # Take screenshot of the hovered state (which might show custom tooltip if there were one, but native won't show in screenshot usually)
    page.screenshot(path="/home/jules/verification/library_search.png")

    print("Verification passed! Attributes are present.")
    browser.close()

with sync_playwright() as playwright:
    run(playwright)
PY

npm run dev &
DEV_PID=$!
sleep 5
python /home/jules/verification/verify.py
kill $DEV_PID
