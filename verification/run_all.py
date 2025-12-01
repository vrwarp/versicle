import subprocess
import sys

def main():
    """
    Main entry point for running the full verification suite.
    Executes pytest on the 'verification/' directory.
    """
    print("🚀 Running verification tests with pytest...")
    # Add -v for verbose, --screenshot=on (if needed, but we handle it manually or via config)
    cmd = [sys.executable, "-m", "pytest", "verification/"]
    result = subprocess.run(cmd)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
