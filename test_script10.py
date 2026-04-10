import subprocess
print("Running test_journey_audio.py locally...")
subprocess.run(["python3", "-m", "pytest", "verification/test_journey_audio.py"])
