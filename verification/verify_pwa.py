import http.server
import socketserver
import threading
import urllib.request
import json
import time
import os

PORT = 8085
DIRECTORY = "dist"

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def start_server():
    # Allow address reuse
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), Handler) as httpd:
        print(f"Serving at port {PORT}")
        httpd.serve_forever()

def get_url(url):
    try:
        with urllib.request.urlopen(url) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as e:
        return e.code, None
    except Exception as e:
        print(f"Request failed: {e}")
        return 0, None

def check_pwa():
    base_url = f"http://localhost:{PORT}"

    # 1. Check index.html for theme-color
    print("Checking index.html...")
    status, content = get_url(base_url + "/index.html")
    if status == 200:
        text = content.decode('utf-8')
        if '<meta name="theme-color" content="#ffffff" />' in text:
            print("✅ theme-color meta tag found.")
        else:
            print("❌ theme-color meta tag NOT found.")
            print(f"Content snippet: {text[:500]}")
            return False
    else:
        print("❌ Failed to load index.html")
        return False

    # 2. Check manifest.webmanifest
    print("Checking manifest...")
    status, content = get_url(base_url + "/manifest.webmanifest")
    if status == 200:
        print("✅ manifest.webmanifest found.")
        try:
            data = json.loads(content.decode('utf-8'))
            if data.get("name") == "Versicle Reader":
                print("✅ Manifest name matches.")
            else:
                print(f"❌ Manifest name mismatch: {data.get('name')}")
        except Exception as e:
                print(f"❌ Failed to parse manifest JSON: {e}")
    else:
        print(f"❌ manifest.webmanifest not found (status {status})")
        return False

    # 3. Check service worker
    print("Checking service worker...")
    status, content = get_url(base_url + "/sw.js")
    if status == 200:
            print("✅ sw.js found.")
    else:
            print("❌ sw.js not found.")
            return False

    # 4. Check icons
    print("Checking icons...")
    status, content = get_url(base_url + "/pwa-192x192.png")
    if status == 200:
        print("✅ pwa-192x192.png found.")
    else:
            print("❌ pwa-192x192.png not found.")

    print("PWA verification passed!")
    return True

if __name__ == "__main__":
    if not os.path.exists(DIRECTORY):
        print(f"❌ Directory {DIRECTORY} does not exist. Run build first.")
        exit(1)

    server_thread = threading.Thread(target=start_server, daemon=True)
    server_thread.start()

    # Give server time to start
    time.sleep(2)

    success = check_pwa()

    if success:
        exit(0)
    else:
        exit(1)
