from playwright.sync_api import sync_playwright

def verify_genai_settings():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1280, "height": 720})
        page = context.new_page()

        try:
            print("Navigating...")
            page.goto("http://localhost:5173")

            settings_btn = page.get_by_test_id("header-settings-button")
            settings_btn.wait_for()
            settings_btn.click()
            print("Settings opened.")

            page.get_by_role("dialog").wait_for(state="visible")

            print("Clicking GenAI tab...")
            page.get_by_role("button", name="Generative AI", exact=True).click()

            page.wait_for_timeout(500)

            # Enable Global AI Features if off
            genai_toggle = page.get_by_label("Enable AI Features")
            if not genai_toggle.is_checked():
                print("Enabling AI Features...")
                genai_toggle.click()
                page.wait_for_timeout(200)

            print("Looking for 'Free Tier Rotation'...")
            page.get_by_text("Free Tier Rotation").wait_for()
            print("Found label.")

            rotation_switch = page.get_by_label("Free Tier Rotation")

            # Enable the rotation toggle
            if not rotation_switch.is_checked():
                print("Enabling Rotation...")
                rotation_switch.click()
                page.wait_for_timeout(200)

            # Verify Model Select is disabled
            model_select = page.locator("button[role='combobox'][disabled]")
            if model_select.count() > 0:
                print("SUCCESS: Found disabled combobox (Model Select).")
            else:
                # Check if it exists but is enabled
                model_select_enabled = page.locator("button[role='combobox']").filter(has_text="Gemini")
                if model_select_enabled.count() > 0:
                     if model_select_enabled.is_disabled():
                         print("SUCCESS: Model Select is disabled.")
                     else:
                         print("FAILURE: Model Select is ENABLED but should be disabled.")
                else:
                    print("WARNING: Could not find Model Select to verify state.")

            page.screenshot(path="verification/genai_settings_final.png")
            print("Verification Complete.")

        except Exception as e:
            print(f"Error: {e}")
            page.screenshot(path="verification/error.png")
            import traceback
            traceback.print_exc()
        finally:
            browser.close()

if __name__ == "__main__":
    verify_genai_settings()
