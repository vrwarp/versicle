# Playwright
All code changes require running the playwright tests to ensure that nothing is broken. Where applicable, new playwrite tests should be created.

**Important:**
1. All playwright tests must record a screenshot in `verification/screenshots/` for key steps to assist in verification and debugging.
2. The playwright tests must be modeled after a user journey. So to test new features or big fixes, find an existing journey that is suitable or create a new one. Make sure the journeys are not too long.
3. If the user asks to update the golden screenshots (goldens for short), you must run the playwright test successfully and replace the `verification/goldens` with the generated screenshots from `verification/screenshots/` and commit it to the repository. Old screenshots should be deleted.

# Build hygene
Always make sure that `npm run build` succeed and `npm run lint` is clean. Fix issues and repeat until it is true.
