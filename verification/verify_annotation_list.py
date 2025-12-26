from playwright.sync_api import sync_playwright

def verify_annotation_list():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        # Use slightly larger viewport to emulate mobile landscape or tablet
        page = browser.new_page(viewport={"width": 1024, "height": 768})

        # Navigate to preview URL
        page.goto("http://localhost:4173")

        # Wait for page load
        page.wait_for_timeout(3000)

        # Take a screenshot
        page.screenshot(path="verification/annotation_list_before.png")

        browser.close()

if __name__ == "__main__":
    verify_annotation_list()
