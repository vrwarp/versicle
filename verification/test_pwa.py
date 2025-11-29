import json
import pytest
from playwright.sync_api import Page, expect

def test_manifest_exists(page: Page):
    """Verify the Web App Manifest exists and has correct properties."""
    # Increase timeout for initial load
    page.goto("/", timeout=5000)

    # Check for manifest link tag
    manifest_link = page.locator("link[rel='manifest']")
    expect(manifest_link).to_have_count(1)

    href = manifest_link.get_attribute("href")
    assert href is not None, "Manifest href is missing"

    # Fetch the manifest content
    response = page.request.get(href)
    assert response.status == 200

    manifest_data = response.json()
    assert manifest_data["name"] == "Versicle Reader"
    assert manifest_data["short_name"] == "Versicle"
    assert manifest_data["start_url"] == "/"
    assert manifest_data["display"] == "standalone"
    assert len(manifest_data["icons"]) >= 2

def test_service_worker_registration(page: Page):
    """Verify that a service worker is registered."""
    page.goto("/", timeout=5000)

    # Wait a bit for SW registration
    page.wait_for_timeout(2000)

    # Check registration via JS
    is_registered = page.evaluate("""async () => {
        const regs = await navigator.serviceWorker.getRegistrations();
        return regs.length > 0;
    }""")

    # In dev mode with devOptions.enabled: true, it should register
    assert is_registered, "Service Worker should be registered"
