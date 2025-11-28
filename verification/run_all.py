import subprocess
import sys

def main():
    print("🚀 Running verification tests with pytest...")
    # Add -v for verbose, --screenshot=on (if needed, but we handle it manually or via config)
    cmd = [sys.executable, "-m", "pytest", "verification/"]
    result = subprocess.run(cmd)
    sys.exit(result.returncode)

if __name__ == "__main__":
    main()
