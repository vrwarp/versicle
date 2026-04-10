import subprocess
import time
print("Starting vite server and running audio test with verbose traceback...")
p = subprocess.Popen(["npm", "run", "dev"])
time.sleep(5)
res = subprocess.run(["python3", "-m", "pytest", "verification/test_journey_audio.py", "-v", "--tb=long"])
print("Test result:", res.returncode)
p.kill()
