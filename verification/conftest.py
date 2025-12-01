import pytest
from playwright.sync_api import Page, expect

@pytest.fixture(scope="session", params=["desktop", "mobile"])
def browser_context_args(request, browser_context_args):
    """
    Configures the browser context arguments for the session.
    Sets the base URL and viewport size.
    Parameterized for desktop and mobile.

    Args:
        browser_context_args: Default arguments from pytest-playwright.

    Returns:
        Updated dictionary of context arguments.
    """
    if request.param == "mobile":
        return {
            **browser_context_args,
            "base_url": "http://localhost:5173",
            "viewport": {"width": 375, "height": 667},
            "is_mobile": True,
            "has_touch": True,
        }
    else:
        return {
            **browser_context_args,
            "base_url": "http://localhost:5173",
            "viewport": {"width": 1280, "height": 720},
        }

@pytest.fixture(scope="session")
def browser_type_launch_args(browser_type_launch_args):
    """
    Configures the browser launch arguments.
    Disables web security to allow local file/blob access in iframes.

    Args:
        browser_type_launch_args: Default launch arguments.

    Returns:
        Updated dictionary of launch arguments.
    """
    return {
        **browser_type_launch_args,
        "args": ["--disable-web-security", "--disable-features=IsolateOrigins,site-per-process"],
    }

@pytest.fixture(autouse=True)
def configure_page(page: Page):
    """
    Configures default timeouts for the Page object and assertions.
    Ensures tests fail fast if elements are missing (2000ms).

    Args:
        page: The Playwright Page object.
    """
    # Set default timeout for actions (click, wait_for_selector, etc) to 2000ms
    page.set_default_timeout(2000)
    page.set_default_navigation_timeout(2000)
    # Set default timeout for assertions
    expect.set_options(timeout=2000)
    yield

@pytest.fixture(autouse=True)
def attach_console_listeners(page: Page):
    """
    Attaches console listeners to print browser logs to the Python console.
    Useful for debugging frontend errors during tests.

    Args:
        page: The Playwright Page object.
    """
    # Enable console logging for debugging
    page.on("console", lambda msg: print(f"PAGE LOG: {msg.text}"))
    page.on("pageerror", lambda err: print(f"PAGE ERROR: {err}"))
    yield
