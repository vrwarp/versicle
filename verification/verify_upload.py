
import asyncio
from playwright.async_api import async_playwright, expect

async def verify_upload_progress():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()

        # Navigate to the app
        await page.goto("http://localhost:5173")

        # Use specific test id for the file uploader input
        file_input = page.get_by_test_id("file-upload-input")
        await expect(file_input).to_be_attached()

        # Create a dummy zip file on disk
        import zipfile
        with zipfile.ZipFile('verification/test.zip', 'w') as zf:
            zf.writestr('test.txt', 'This is a test file to create a valid zip structure.')

        # Upload the file
        await file_input.set_input_files('verification/test.zip')

        # Capture screenshot immediately after upload
        await page.wait_for_timeout(500)

        await page.screenshot(path="verification/verification.png")

        await browser.close()

if __name__ == "__main__":
    asyncio.run(verify_upload_progress())
