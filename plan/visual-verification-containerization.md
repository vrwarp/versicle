# **Technical Design Document: Visual Verification Containerization**

Author: AI Assistant  
Status: Proposed  
Date: 2025-12-05

## **1\. Overview**

This document proposes a comprehensive re-architecture of the Visual Verification workflow for the Versicle application to address persistent instability in our automated testing pipeline. The primary objective is to eliminate false positives in visual regression tests caused by Operating System (OS) level rendering differences between local development environments (typically macOS or Windows) and the Continuous Integration (CI) environment (Ubuntu Linux).

By standardizing the test execution environment, we aim to reduce developer fatigue associated with "flaky" tests and ensure that a failed test represents a genuine regression in the user interface rather than a difference in font rasterization algorithms. This document outlines the technical strategy for shifting our testing paradigm from "bare metal" execution to a containerized "immutable infrastructure" approach.

## **2\. Problem Statement**

The current visual verification suite uses Playwright combined with Python to capture and compare screenshots of the application against a set of "golden" baseline images. While this approach is effective for detecting functional regressions, it suffers from a critical flaw regarding environment consistency:

* **Local Environment:** Developers run tests directly on their host machines, which are predominantly macOS (using CoreText for rendering) or Windows (using DirectWrite).  
* **CI Environment:** GitHub Actions executes the same tests on Ubuntu runners (using FreeType/Fontconfig).

**The Core Issue:** Browser rendering engines—specifically Chromium, WebKit, and Firefox—do not render text and geometric primitives identically across different operating systems. Even with identical CSS, HTML, and browser versions, the host OS dictates how fonts are smoothed, anti-aliased, and hinted.

For example, a standard sans-serif font may render 1 pixel wider on Linux than on macOS due to sub-pixel rendering differences. In a pixel-by-pixel visual regression test, a 1-pixel shift in a container's width can cascade down the entire page layout, causing the screenshot comparison to fail with a high percentage of difference. This forces developers to constantly regenerate "golden" images whenever they switch environments, rendering the CI pipeline unreliable and creating a "works on my machine" bottleneck that slows down the merge process.

## **3\. Goals & Non-Goals**

### **3.1 Goals**

* **Absolute Consistency:** Ensure that the verification/run\_all.py script produces bit-exact, identical screenshots regardless of the machine it runs on. A test run on a developer's MacBook Air must yield the exact same binary image data as a test run on a GitHub Actions runner or a Windows workstation.  
* **Local Reproducibility:** A developer must be able to reproduce a CI failure locally without pushing code to the repository. The debugging loop should be immediate: pull the branch, run the container, and see the exact same failure reported by CI.  
* **Simplified Developer Experience (DX):** Provide a single, unified command (abstracted via script or Docker CLI) that handles dependency installation, app building, and test execution. This removes the need for developers to manage local Python environments, Playwright browser binaries, or Node.js version mismatches.  
* **Environment Isolation:** Decouple the testing environment from the host machine's configuration. Updates to the developer's local OS or system fonts should never impact the test results.

### **3.2 Non-Goals**

* **Cross-Browser Testing:** While Playwright supports multiple browsers, we are strictly focusing on stabilizing the default browser (Chromium) first. Expanding the visual regression suite to cover Firefox and Safari (WebKit) rendering differences is a future optimization and out of scope for this specific consistency fix.  
* **Modifying App Rendering:** We will not modify the application code (App.tsx, CSS, or global styles) to "force" simpler rendering (e.g., disabling anti-aliasing via CSS). Such changes degrades the user experience for the sake of tooling; instead, we will upgrade the tooling to handle the rendering correctly.  
* **Performance Optimization:** While containerization may introduce a slight overhead compared to native execution, execution speed is secondary to execution reliability. We accept a potential marginal increase in test duration in exchange for 100% stability.

## **4\. Proposed Solution**

We will strictly containerize the test execution environment using Docker. By running the tests inside a Linux Docker container on all platforms, we guarantee that the entire rendering stack—from the OS kernel calls to the font libraries and browser engine—is identical.

### **4.1 Architecture**

The proposed architecture introduces a "Test Runner Container" that sits between the source code and the execution results.

1. **Base Image Strategy:** We will utilize the official Microsoft Playwright image (mcr.microsoft.com/playwright/python:v1.48.0-jammy) as our foundation. This image is maintained by the Playwright team and comes pre-packaged with:  
   * **Python 3.10+**: Ensuring language compatibility.  
   * **Node.js**: Essential for building and serving the Vite-based frontend.  
   * **Browser Binaries**: Pre-installed versions of Chromium, Firefox, and WebKit that match the Playwright library version, eliminating binary mismatch errors.  
   * **System Dependencies**: All necessary shared libraries (GStreamer, codecs, font libraries) required to run "headless" browsers in a Linux environment.  
2. **Container Workflow:** The lifecycle of a test run will be fully encapsulated:  
   * **Ingest:** The container mounts or copies the current source code directory.  
   * **Provision:** Dependencies are installed cleanly (npm ci, pip install) to ensure package-lock.json integrity.  
   * **Build:** The Vite application is built for production (npm run build) to test the actual deployable artifacts.  
   * **Serve:** A local preview server is spun up within the container network namespace.  
   * **Execute:** The Python verification script runs against the internal server http://localhost:5173.  
   * **Export:** Failure artifacts (diff images) are written back to the host system via volume mounts for inspection.

## **5\. Detailed Design**

### **5.1 Dockerfile Configuration (Dockerfile.verification)**

We will introduce a dedicated Dockerfile.verification to avoid bloating the production Dockerfile. This separation allows us to include heavy testing tools (browsers, test runners) without increasing the size of the image used for actual deployment.

* **Base Image:** mcr.microsoft.com/playwright/python:v1.48.0-jammy. Using a pinned version (v1.48.0) is crucial. We will not use latest to prevent unexpected breakages when Playwright updates.  
* **Environment Setup:**  
  * We must install a specific version of Node.js (v18 or v20) to match our production environment. The base image might ship with a different version, so we will explicitly curl the Node source setup script.  
  * Set the working directory to /app to mirror standard conventions.  
* **Build Steps:**  
  * **Layer Caching:** We will copy package.json and package-lock.json first, then run npm ci. This allows Docker to cache the node\_modules layer, significantly speeding up subsequent local runs.  
  * **Python Deps:** We will execute pip install pytest pytest-playwright immediately after.  
  * **Source Copy:** Only after dependencies are installed do we copy the full source code (.). This ensures that changing a single line of code doesn't force a re-download of all dependencies.  
* **Entrypoint:** The container will default to executing a custom shell script that orchestrates the runtime services.

### **5.2 Entrypoint Script (verification/docker\_entrypoint.sh)**

This shell script acts as the lightweight process manager (init system) within the ephemeral container. It is responsible for the "Start-Wait-Test" sequence.

1. **Service Startup:** It executes npm run preview \-- \--port 5173 \--host in the background (using the & operator). The \--host flag is mandatory to bind the server to 0.0.0.0, ensuring it is accessible within the container's network interface.  
2. **Health Check:** Instead of a fixed sleep timer, the script will enter a polling loop using curl or wget. It will attempt to reach http://localhost:5173 every second until it receives a 200 OK response or times out (e.g., after 30 seconds). This optimizes run time; tests start exactly when the app is ready.  
3. **Test Execution:** Once the app is live, it executes python verification/run\_all.py.  
4. **Exit Handling:** The script captures the exit code of the python test suite and passes it through as the container's exit code. This ensures that if tests fail, the GitHub Action job also fails.

### **5.3 GitHub Actions Workflow Update**

The .github/workflows/visual-verification.yml file will be drastically simplified. We effectively move the complexity from the YAML file (configuration management) to the Dockerfile (environment management).

* **Step 1: Checkout:** Standard checkout of the repo.  
* **Step 2: Build Image:** Run docker build \-t versicle-verify \-f Dockerfile.verification ..  
* **Step 3: Run Container:** Run docker run \--rm \-v ${{ github.workspace }}/verification/screenshots:/app/verification/screenshots versicle-verify.  
  * **Volume Mounting:** The \-v flag is critical here. It maps the host runner's directory to the container. If a test fails, the container writes the diff image to /app/verification/screenshots, which actually saves it to the GitHub runner's filesystem.  
* **Step 4: Artifact Upload:** The workflow then uploads the contents of that host directory as an artifact, exactly as it does today.

### **5.4 Local Developer Workflow**

To align with this new architecture, developers will shift from running python verification/run\_all.py to running a Docker command. We will provide a convenience snippet or Make target:

\# Developer Command  
docker build \-t versicle-verify \-f Dockerfile.verification .  
docker run \--rm \\  
  \-v $(pwd)/verification/screenshots:/app/verification/screenshots \\  
  versicle-verify

This command builds the image (using cache if available) and runs the test suite. If a test fails, the developer can immediately look in their local verification/screenshots folder to see the generated diffs, just as if they had run the test natively.

## **6\. Implementation Steps**

The execution of this design will follow a strict sequence to ensure stability:

1. **Create Dockerfile.verification:** Draft the Dockerfile, ensuring correct Node.js installation and verifying that the npm build step succeeds within the container environment.  
2. **Create verification/docker\_entrypoint.sh:** Write the orchestration script. Test this locally by exec-ing into the container and running it manually to tune the timeout thresholds.  
3. **Local Baseline Regeneration:**  
   * **Action:** Run the new Docker container locally.  
   * **Outcome:** All tests *will* fail initially because the new Linux-rendered screenshots will not match the old macOS/Windows "golden" images.  
   * **Remediation:** We will use the container to regenerate the goldens. We will invoke pytest with the \--update-snapshots flag (or equivalent logic in our runner) inside the container. These new images become the canonical source of truth.  
4. **Modify GitHub Actions:** Update the YAML workflow to use the Docker steps. Push the new workflow *and* the new golden images in a single commit to ensure the pipeline passes green.

## **7\. Security Considerations**

* **Network Isolation:** The testing container runs in a standard Docker bridge network. It does not require access to the external internet during the *test execution* phase (only during the build phase to fetch packages).  
* **Privileged Mode:** The Playwright container does *not* strictly require \--privileged mode for Chromium, but it does require specific seccomp profiles or the disabling of certain security features like site-per-process if strictly sandboxing is not required for trusted internal code. We will use the flag \--ipc=host or adequate shared memory (--shm-size) to prevent browser crashes during heavy rendering, which is a standard requirement for Chrome in Docker.  
* **File Access:** The \--disable-web-security flag used in our Playwright browser context is contained entirely within the Docker environment. This lowers the risk compared to running a disabled-security browser directly on a developer's workstation, as the container provides an additional layer of isolation from the host file system.
