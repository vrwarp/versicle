import { test, expect, openSettings, gotoSettingsTab, acceptConfirm } from './utils';

test('verify firebase config clear', async ({ page }) => {
  // Navigate to app
  await page.goto('/');

  // Open Global Settings (Radix-Tabs SettingsShell over the library)
  await openSettings(page);

  // Go to Sync tab (now a real Radix tab, not a role=button)
  await gotoSettingsTab(page, 'sync');

  // Verify Firebase Config section appears
  await expect(page.getByRole('heading', { name: 'Firebase Configuration' })).toBeVisible();

  // Enter dummy config
  const dummyConfig = `
const firebaseConfig = {
  apiKey: "dummy-api-key",
  authDomain: "dummy.firebaseapp.com",
  projectId: "dummy-project",
  appId: "dummy-app-id"
};
`;
  // Find the textarea
  await page.getByPlaceholder('// Paste your Firebase config here').fill(dummyConfig);

  // Wait for isConfigured to trigger (useEffect or render update)
  // The UI should switch to "Sign In" state
  await expect(page.getByText('Sign in with Google')).toBeVisible();

  // Now look for "Clear Configuration" button
  const clearBtn = page.getByRole('button', { name: 'Clear Configuration' });
  await expect(clearBtn).toBeVisible();

  // Confirm via the in-app ConfirmDialog ("Clear Firebase configuration?")
  // — the old window.confirm() became a Radix ConfirmDialog (Phase-10 overhaul).
  await clearBtn.click();
  await acceptConfirm(page);

  // Verify we are back to the form
  await expect(page.getByPlaceholder('// Paste your Firebase config here')).toBeVisible();

  // Verify fields are empty (or at least the form is visible)
  await expect(page.locator("input[type='password']").first()).toHaveValue('');
});
