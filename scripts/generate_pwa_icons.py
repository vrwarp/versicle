import os
import binascii

def generate_icon(filename, size):
    # Minimal 1x1 PNG (Red)
    # Source: https://garethrees.org/2007/11/14/pngcrush/
    hex_data = "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415408d763f8cf000002030101f37e583b0000000049454e44ae426082"

    data = binascii.unhexlify(hex_data)

    path = os.path.join("public", filename)
    with open(path, "wb") as f:
        f.write(data)
    print(f"Generated {path}")

def main():
    if not os.path.exists("public"):
        os.makedirs("public")

    generate_icon("pwa-192x192.png", 192)
    generate_icon("pwa-512x512.png", 512)

if __name__ == "__main__":
    main()
