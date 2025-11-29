
from playwright.sync_api import sync_playwright

def verify_immersive_mode():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={'width': 1280, 'height': 720})
        page = context.new_page()

        try:
            page.goto('http://localhost:5173/')

            # Upload book if needed
            if page.get_by_text("Alice's Adventures in Wonderland").count() == 0:
                page.set_input_files("input[type='file']", "src/test/fixtures/alice.epub")
                page.wait_for_selector("text=Alice's Adventures in Wonderland", timeout=10000)

            page.click("text=Alice's Adventures in Wonderland")
            page.wait_for_selector("[data-testid='reader-iframe-container']", timeout=10000)

            # Screenshot 1: Default View
            page.screenshot(path="verification/screenshots/1_default_view.png")

            # Toggle Immersive Mode
            viewport_size = page.viewport_size
            if viewport_size:
                x = viewport_size['width'] / 2
                y = viewport_size['height'] / 2
                page.mouse.click(x, y)

            # Wait for animation
            page.wait_for_timeout(1000)

            # Screenshot 2: Immersive Mode
            page.screenshot(path="verification/screenshots/2_immersive_view.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    verify_immersive_mode()
