import os
import sys
from playwright.sync_api import sync_playwright, expect

sys.path.append(os.getcwd())

def verify_search_sidebar():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()

        try:
            page.goto("http://localhost:4173", timeout=10000)
            print(f"Page title: {page.title()}")
            page.screenshot(path="verification/verification.png")
            print("Screenshot taken of home page.")
        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_search_sidebar()
