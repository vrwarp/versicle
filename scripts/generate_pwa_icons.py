import os
from PIL import Image, ImageDraw

def generate_icon(filename, size):
    # Create a new image with a white background
    img = Image.new('RGBA', (size, size), color=(255, 255, 255, 255))
    draw = ImageDraw.Draw(img)

    # Calculate dimensions for the "V"
    # We'll draw a thick "V" using a polygon
    padding = size * 0.2
    width = size - 2 * padding
    height = size - 2 * padding

    # Define points for a thick V shape
    # Outer V
    p1 = (padding, padding) # Top Left
    p2 = (size / 2, size - padding) # Bottom Center
    p3 = (size - padding, padding) # Top Right

    # Inner V (to create thickness)
    thickness = size * 0.15
    p4 = (size - padding - thickness, padding)
    p5 = (size / 2, size - padding - thickness) # Inner Bottom
    p6 = (padding + thickness, padding)

    # Draw the V in black (or brand color)
    # Using a simple polygon: p1 -> p2 -> p3 -> p4 -> p5 -> p6 -> p1
    points = [p1, p2, p3, p4, p5, p6]

    # Versicle blue-ish color maybe? Let's use #2563eb (Tailwind blue-600) -> (37, 99, 235)
    color = (37, 99, 235, 255)

    draw.polygon(points, fill=color)

    path = os.path.join("public", filename)
    img.save(path, "PNG")
    print(f"Generated {path} ({size}x{size})")

def main():
    if not os.path.exists("public"):
        os.makedirs("public")

    generate_icon("pwa-192x192.png", 192)
    generate_icon("pwa-512x512.png", 512)

if __name__ == "__main__":
    main()
