import pytest
import time
from playwright.sync_api import sync_playwright, Page, expect

@pytest.fixture(scope="session")
def android_device():
    """
    Connects to the first available Android device via ADB.
    Scope is session to avoid reconnecting for every test.
    """
    with sync_playwright() as p:
        devices = p.android.devices()
        if not devices:
            pytest.skip("No android devices found. Ensure emulator is running or device is connected.")
        device = devices[0]
        print(f"Connected to device: {device.model()} ({device.serial()})")
        yield device
        device.close()

def _launch_app(device):
    package_name = "com.vrwarp.versicle"

    # We assume 'am force-stop' was called or we call it to be safe
    device.shell(f"am force-stop {package_name}")

    # Launch the app
    device.shell(f"am start -n {package_name}/.MainActivity")

    # Poll for the WebView
    webview = None
    for _ in range(30):
        webviews = device.web_views()
        for wv in webviews:
            if wv.pkg() == package_name:
                webview = wv
                break
        if webview:
            break
        time.sleep(1)

    if not webview:
        pytest.fail(f"Could not find WebView for package {package_name}")

    page = webview.page()

    # Configure timeouts
    page.set_default_timeout(5000)
    page.set_default_navigation_timeout(5000)
    expect.set_options(timeout=5000)

    # Attach console listeners
    page.on("console", lambda msg: print(f"ANDROID PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda err: print(f"ANDROID PAGE ERROR: {err}"))

    return page

@pytest.fixture(scope="function")
def android_page(android_device):
    """
    Launches the application and connects to its WebView.
    """
    page = _launch_app(android_device)
    yield page
    android_device.shell("am force-stop com.vrwarp.versicle")

@pytest.fixture(scope="function")
def fresh_android_page(android_device):
    """
    Clears app data, then launches the application.
    """
    package_name = "com.vrwarp.versicle"
    android_device.shell(f"pm clear {package_name}")

    page = _launch_app(android_device)
    yield page
    android_device.shell(f"am force-stop {package_name}")
