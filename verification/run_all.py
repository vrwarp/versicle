import subprocess
import sys

def main():
    """
    Main entry point for running the full verification suite.
    Executes pytest on the 'verification/' directory.
    Passes any command-line arguments to pytest.
    """
    print("🚀 Running verification tests with pytest...")

    # Base command
    cmd = [sys.executable, "-m", "pytest", "verification/"]

    # Check if user provided -n or --numprocesses argument to control parallelism
    if not any(arg.startswith("-n") or arg.startswith("--numprocesses") for arg in sys.argv):
        # Default to auto parallelism (utilize all available cores)
        cmd.extend(["-n", "auto"])

    # Append any arguments passed to this script (e.g. --update-snapshots)
    # sys.argv[0] is the script name, so we take everything after it.
    cmd.extend(sys.argv[1:])

    print(f"Executing: {' '.join(cmd)}")
    result = subprocess.run(cmd)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
