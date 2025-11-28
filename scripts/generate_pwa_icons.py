import struct
import zlib
import os

def write_png(width, height, filename):
    # Signature
    png = b'\x89PNG\r\n\x1a\n'

    # IHDR
    ihdr = b'IHDR' + struct.pack('!IIBBBBB', width, height, 8, 2, 0, 0, 0)
    ihdr += struct.pack('!I', zlib.crc32(ihdr) & 0xFFFFFFFF)
    png += struct.pack('!I', len(ihdr)-4) + ihdr

    # IDAT
    # 3 bytes per pixel (RGB). scanlines.
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00' # Filter type 0
        for x in range(width):
            # Gradient or color (Blue-ish gradient)
            raw_data += struct.pack('BBB', (x % 255), (y % 255), 200)

    compressed = zlib.compress(raw_data)
    idat = b'IDAT' + compressed
    idat += struct.pack('!I', zlib.crc32(idat) & 0xFFFFFFFF)
    png += struct.pack('!I', len(idat)-4) + idat

    # IEND
    iend = b'IEND'
    iend += struct.pack('!I', zlib.crc32(iend) & 0xFFFFFFFF)
    png += struct.pack('!I', len(iend)-4) + iend

    with open(filename, 'wb') as f:
        f.write(png)
    print(f"Generated {filename}")

if __name__ == "__main__":
    write_png(192, 192, 'public/pwa-192x192.png')
    write_png(512, 512, 'public/pwa-512x512.png')
