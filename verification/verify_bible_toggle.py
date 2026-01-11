import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    # Go to app
    page.goto("http://localhost:5173")

    # Wait for app to load (library view)
    page.wait_for_selector('button[aria-label="Settings"]', state="visible")

    # Open Settings
    page.click('button[aria-label="Settings"]')

    # Wait for modal
    page.wait_for_selector('div[role="dialog"]', state="visible")

    # Go to Dictionary tab
    page.click("text=Dictionary")

    # Wait for content
    time.sleep(1)

    # Screenshot the Dictionary tab showing the new toggle
    page.screenshot(path="verification/bible_toggle.png")

    browser.close()

with sync_playwright() as playwright:
    run(playwright)
