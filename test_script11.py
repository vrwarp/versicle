import subprocess
import time
print("Starting vite server and running audio test with tb=auto...")
p = subprocess.Popen(["npm", "run", "dev"])
time.sleep(5)
res = subprocess.run(["python3", "-m", "pytest", "verification/test_journey_audio.py"])
print("Test result:", res.returncode)
p.kill()
