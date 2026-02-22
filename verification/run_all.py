import subprocess
import sys

def main():
    """
    Main entry point for running the verification suite.
    Executes pytest.
    If specific test files/directories are provided as arguments, runs those.
    Otherwise, defaults to running all tests in 'verification/'.
    """
    print("🚀 Running verification tests with pytest...")

    # Base command
    cmd = [sys.executable, "-m", "pytest"]

    extra_args = sys.argv[1:]

    # Check if user provided -n or --numprocesses argument to control parallelism
    if not any(arg.startswith("-n") or arg.startswith("--numprocesses") for arg in extra_args):
        # Default to auto parallelism (utilize all available cores)
        cmd.extend(["-n", "auto"])

    cmd.extend(extra_args)

    # Heuristic: if no arguments look like files/directories (do not start with -),
    # default to 'verification/' directory.
    # We check for existence of non-option arguments.
    has_targets = any(not arg.startswith("-") for arg in extra_args)

    if not has_targets:
        cmd.append("verification/")

    print(f"Executing: {' '.join(cmd)}")
    result = subprocess.run(cmd)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
