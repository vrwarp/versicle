# Playwright Verification Suite
The verification suite is written as playwright tests. All code changes require running the verification suite to ensure that nothing is broken. When new features are introduced, new playwrite tests should be created for the corresponding new journeys.

**Important:**
1. All playwright tests must record a screenshot in `verification/screenshots/` for key steps to assist in verification and debugging.
2. The playwright tests must be modeled after a user journey. So to test new features or big fixes, find an existing journey that is suitable or create a new one. Make sure the journeys are not too long.
3. If the user asks to update the golden screenshots (goldens for short), you must run the playwright test successfully via the container and replace the `verification/goldens` with the generated screenshots from `verification/screenshots/` and commit it to the repository. Old screenshots should be deleted.
4. The main way to run the playwright verification test suite is via Docker:
   ```bash
   docker build -t versicle-verify -f Dockerfile.verification .
   mkdir -p verification/screenshots
   docker run --rm -v $(pwd)/verification/screenshots:/app/verification/screenshots versicle-verify
   ```
5. The individual verification tests are located in `verification/test_*.py`.

# Testing
Never override PYTHONPATH for running tests because the testing environment does not do that either.

# Before you submit
1. Always make sure that `npm run build` succeed and `npm run lint` is clean. Fix issues and repeat until it is true.
2. Check that the playwright verification suite succeeds (using the Docker container). Fix issues and repeat until it is true.
3. Check that the `npm test` succeed. Fix issues and repeat until it is true.
