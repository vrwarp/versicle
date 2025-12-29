import time
from playwright.sync_api import sync_playwright

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()

    # 1. Reset App
    page.goto("http://localhost:5173")
    page.evaluate("window.localStorage.clear()")
    page.evaluate("window.indexedDB.databases().then(dbs => { dbs.forEach(db => window.indexedDB.deleteDatabase(db.name)) })")
    page.reload()

    # 2. Upload Book
    page.set_input_files("input[type='file']", "verification/alice.epub")
    time.sleep(2)
    page.click("[data-testid^='book-card-']")
    time.sleep(3)

    # 3. Open Audio Panel
    page.click("[data-testid='reader-audio-button']")
    time.sleep(1)
    page.screenshot(path="verification/step1_audio_open.png")

    # 4. Press Browser Back
    page.go_back()
    time.sleep(1)

    if not page.is_visible("text=Audio Deck"):
        print("Audio Deck closed after back button. Success.")
        page.screenshot(path="verification/step2_audio_closed.png")
    else:
        print("Audio Deck DID NOT close.")

    browser.close()

with sync_playwright() as p:
    run(p)
