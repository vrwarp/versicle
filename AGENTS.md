# Playwright Verification Suite
The verification suite is written as playwright tests. All code changes require running the verification suite to ensure that nothing is broken. When new features are introduced, new playwrite tests should be created for the corresponding new journeys.

**Important:**
1. All playwright tests must record a screenshot in `verification/screenshots/` for key steps to assist in verification and debugging.
2. The playwright tests must be modeled after a user journey. So to test new features or big fixes, find an existing journey that is suitable or create a new one. Make sure the journeys are not too long.
3a. If you are Jules, then the main way to run the playwright verification test suite is via the `jules_run_verification.sh` wrapper script. This handles building the Docker image and mounting the screenshots directory automatically:
   ```bash
   # Run all tests
   ./jules_run_verification.sh

   # Run a specific test file
   ./jules_run_verification.sh verification/test_journey_sync.py

   # Run with specific pytest flags (e.g. no parallelism)
   ./jules_run_verification.sh -n 0 verification/test_bug_spacer.py
   ```
3b. If you are not Jules, then the main way to run the playwright verification test suite is via the `run_verification.sh` wrapper script. This handles building the Docker image and mounting the screenshots directory automatically:
   ```bash
   # Run all tests
   ./run_verification.sh

   # Run a specific test file
   ./run_verification.sh verification/test_journey_sync.py

   # Run with specific pytest flags (e.g. no parallelism)
   ./run_verification.sh -n 0 verification/test_bug_spacer.py
   ```
4. The individual verification tests are located in `verification/test_*.py`.
5. Timeouts are often caused by bugs or flakiness in the code or the test. It is rarely a performance issue, so increasing the timeout should be a last resort.

# Android Docker Tests
Use Docker to run Android unit tests in a consistent environment.

1.  Build the Image:

    ```source-shell
    sudo docker build -t versicle-android -f Dockerfile.android .
    ```

2.  Run Tests:

    ```source-shell
    sudo docker run --rm versicle-android
    ```

# Testing
Never override PYTHONPATH for running tests because the testing environment does not do that either.

# Docker
You need to use `sudo` to run docker.

# Pull Request Prerequisite
1. Always make sure that `npm run build` succeed and `npm run lint` is clean. Fix issues and repeat until it is true.
2. Check that the playwright verification suite succeeds (using the Docker container). Fix issues and repeat until it is true.
3. Check that the `npm test` succeed. Fix issues and repeat until it is true.

# Project README.md
Whenever you update the project `README.md` file, make sure to include as a preamble an explanation for what `Google Jules` is and that `Versicle` is an experimental project implemented almost entirely with `Jules`.

# Updating the EpubLibraryDB versions
Whenever you update the `EpubLibraryDB` version located in `src/db/db.ts`, you must update the version found in these two verification tests:
1. verification/test_journey_sync.py
2. verification/test_maintenance.py


