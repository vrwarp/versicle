from PIL import Image, ImageDraw

def generate_icon(size):
    # Colors (Light Theme Primary: #0f172a (dark blue/black), Background: #ffffff)
    bg_color = (255, 255, 255)
    fg_color = (15, 23, 42) # #0f172a

    # Create background
    img = Image.new('RGB', (size, size), color=bg_color)
    d = ImageDraw.Draw(img)

    # Design: A serif-style "V"
    # We will draw it using a polygon to define the shape precisely.
    # Coordinates are normalized to (0,0) -> (1,1) then scaled by size.

    # Points for a V with modulated strokes (thick right, thin left) and serifs.
    # Left stem (thin)
    # Right stem (thick)

    # Let's verify the shape with relative coordinates:
    # 0,0 is top-left.

    # Top-Left Serif
    pts = [
        (0.15, 0.20), # Top-Left Outer
        (0.30, 0.20), # Top-Left Inner
        (0.50, 0.80), # Bottom Point (Outer-ish)
        (0.70, 0.20), # Top-Right Inner
        (0.85, 0.20), # Top-Right Outer
        (0.50, 1.00), # Bottom Tip
    ]

    # Adjusting for thickness difference
    # Let's try to define the inner cutout triangle and the outer silhouette.

    # Outer Silhouette
    outer_poly = [
        (0.10, 0.20), # Top-left serif start
        (0.30, 0.20), # Top-left serif end
        (0.50, 0.85), # Bottom V junction (approx)
        (0.70, 0.20), # Top-right serif start
        (0.90, 0.20), # Top-right serif end
        (0.50, 1.00), # Bottom point
    ]

    # This is tricky without a visualizer.
    # Let's go with a geometric V that is clean and professional.
    # Two trapezoids meeting at the bottom.

    # Left stroke (Thin)
    # P1: (0.2, 0.2)
    # P2: (0.3, 0.2)
    # P3: (0.5, 0.9)
    # P4: (0.4, 0.9) <-- This would make it disconnected at bottom if not careful

    # Let's use a single polygon for the whole letter.

    # Points (x, y)
    poly_points = [
        (0.15, 0.20), # 1. Top-Left Ext
        (0.28, 0.20), # 2. Top-Left Int
        (0.50, 0.85), # 3. Bottom Valley (The "crotch" of the V)
        (0.72, 0.20), # 4. Top-Right Int
        (0.85, 0.20), # 5. Top-Right Ext
        (0.50, 1.00), # 6. Bottom Point
    ]

    # To fix point 3, we need to calculate where the inner lines meet.
    # Line 2-3 and Line 4-3? No.
    # The inner cutout is defined by the line from (0.28, 0.20) to approx (0.5, 0.8)
    # and (0.72, 0.20) to that same point.

    # Let's adjust slightly for a nicer look.
    # Left stem width at top: 0.13
    # Right stem width at top: 0.13

    # Let's make right stem thicker.
    # Left stem top width: 0.10
    # Right stem top width: 0.20

    p1 = (0.15, 0.20) # Top-Left Ext
    p2 = (0.25, 0.20) # Top-Left Int

    p4 = (0.75, 0.20) # Top-Right Int
    p5 = (0.95, 0.20) # Top-Right Ext

    p6 = (0.50, 0.95) # Bottom Tip

    # Inner valley point (P3) calculation
    # Left inner line: passes through p2 and approx (0.5, 0.85)
    # Right inner line: passes through p4 and approx (0.5, 0.85)
    # Let's manually place P3
    p3 = (0.50, 0.75)

    scaled_poly = [(x * size, y * size) for x, y in [p1, p2, p3, p4, p5, p6]]

    d.polygon(scaled_poly, fill=fg_color)

    filename = f"public/pwa-{size}x{size}.png"
    img.save(filename)
    print(f"Generated {filename}")

if __name__ == "__main__":
    import os
    if not os.path.exists("public"):
        os.makedirs("public")

    generate_icon(192)
    generate_icon(512)
