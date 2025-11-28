import pytest
from playwright.sync_api import Page, expect

@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    return {
        **browser_context_args,
        "base_url": "http://localhost:5173",
        "viewport": {"width": 1280, "height": 720},
    }

@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    return {
        **browser_type_launch_args,
        "args": ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
    }

@pytest.fixture(autouse=True)
def configure_page(page: Page):
    # Set default timeout for actions (click, wait_for_selector, etc) to 2000ms
    page.set_default_timeout(2000)
    page.set_default_navigation_timeout(2000)
    # Set default timeout for assertions
    expect.set_options(timeout=2000)
    yield

@pytest.fixture(autouse=True)
def attach_console_listeners(page: Page):
    # Enable console logging for debugging
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))
    yield
