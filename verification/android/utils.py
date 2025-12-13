import os
from playwright.sync_api import Page, Device

def capture_screenshot(page: Page, name: str):
    """
    Captures a screenshot of the current page state.
    Saves it to 'verification/android/screenshots/'.

    Args:
        page: The Playwright Page object.
        name: The filename (without extension) for the screenshot.
    """
    os.makedirs('verification/android/screenshots', exist_ok=True)
    page.screenshot(path=f"verification/android/screenshots/{name}.png")

def ensure_empty_library(device: Device, package_name="com.vrwarp.versicle"):
    """
    Clears the application data to ensure a fresh state.
    WARNING: This stops the application. You must restart it after calling this.
    """
    print("Clearing app data to ensure empty library...")
    device.shell(f"pm clear {package_name}")
