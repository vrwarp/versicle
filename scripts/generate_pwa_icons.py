import struct
import zlib

def write_chunk(f, chunk_type, data):
    # Length (data only)
    f.write(struct.pack('!I', len(data)))
    # Type + Data
    chunk_body = chunk_type + data
    f.write(chunk_body)
    # CRC (Type + Data)
    f.write(struct.pack('!I', zlib.crc32(chunk_body) & 0xFFFFFFFF))

def write_png(width, height, filename):
    with open(filename, 'wb') as f:
        # Signature
        f.write(b'\x89PNG\r\n\x1a\n')

        # IHDR
        # width, height, bit_depth=8, color_type=2(RGB), compression=0, filter=0, interlace=0
        ihdr_data = struct.pack('!IIBBBBB', width, height, 8, 2, 0, 0, 0)
        write_chunk(f, b'IHDR', ihdr_data)

        # IDAT
        # 3 bytes per pixel (RGB). scanlines.
        # We construct raw data for all scanlines
        raw_data = bytearray()
        for y in range(height):
            raw_data.append(0) # Filter type 0
            for x in range(width):
                 # Blue-ish gradient
                raw_data.extend(struct.pack('BBB', (x % 255), (y % 255), 200))

        compressed = zlib.compress(raw_data)
        write_chunk(f, b'IDAT', compressed)

        # IEND
        write_chunk(f, b'IEND', b'')

    print(f"Generated {filename}")

if __name__ == "__main__":
    write_png(192, 192, 'public/pwa-192x192.png')
    write_png(512, 512, 'public/pwa-512x512.png')
