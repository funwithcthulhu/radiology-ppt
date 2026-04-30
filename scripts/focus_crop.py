from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw


def clamp(value: float, lower: float, upper: float) -> float:
    return max(lower, min(upper, value))


def crop_config(crop_mode: str) -> tuple[float, float, float, float]:
    mode = (crop_mode or "default").strip().lower()
    if mode == "tighter":
        return 3.0, 0.34, 0.32, 0.78
    if mode == "wider":
        return 5.1, 0.58, 0.48, 0.96
    return 4.0, 0.48, 0.42, 0.9


def crop_bounds(
    width: int,
    height: int,
    points: list[dict[str, float]],
    crop_mode: str = "default",
) -> tuple[int, int, int, int]:
    xs = [float(point.get("x", width / 2)) for point in points if point.get("x") is not None]
    ys = [float(point.get("y", height / 2)) for point in points if point.get("y") is not None]
    if not xs or not ys:
        return 0, 0, width, height

    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    center_x = (min_x + max_x) / 2
    center_y = (min_y + max_y) / 2

    spread_x = max(20.0, max_x - min_x)
    spread_y = max(20.0, max_y - min_y)
    spread_scale, min_fraction, lower_fraction, upper_fraction = crop_config(crop_mode)
    target_w = clamp(max(spread_x * spread_scale, width * min_fraction), width * lower_fraction, width * upper_fraction)
    target_h = clamp(max(spread_y * spread_scale, height * min_fraction), height * lower_fraction, height * upper_fraction)

    left = clamp(center_x - target_w / 2, 0, max(0, width - target_w))
    top = clamp(center_y - target_h / 2, 0, max(0, height - target_h))
    right = left + target_w
    bottom = top + target_h
    return round(left), round(top), round(right), round(bottom)


def draw_focus_rings(image: Image.Image, points: list[dict[str, float]]) -> Image.Image:
    if not points:
        return image

    overlay = image.copy()
    draw = ImageDraw.Draw(overlay, "RGBA")
    radius = max(18, round(min(image.width, image.height) * 0.055))
    outer_radius = round(radius * 1.24)
    outer_width = max(2, round(radius * 0.08))
    inner_width = max(2, round(radius * 0.05))

    for point in points:
        if point.get("x") is None or point.get("y") is None:
            continue
        x = float(point["x"])
        y = float(point["y"])
        draw.ellipse(
            (x - outer_radius, y - outer_radius, x + outer_radius, y + outer_radius),
            outline=(15, 61, 84, 176),
            width=outer_width,
        )
        draw.ellipse(
            (x - radius, y - radius, x + radius, y + radius),
            outline=(255, 255, 255, 228),
            width=inner_width,
        )

    return overlay


def main() -> int:
    if len(sys.argv) not in {4, 5}:
        print("Usage: focus_crop.py <input> <output> <points-json> [options-json]", file=sys.stderr)
        return 1

    input_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    points = json.loads(sys.argv[3])
    options = json.loads(sys.argv[4]) if len(sys.argv) >= 5 else {}
    crop_mode = str(options.get("cropMode", "default"))
    markup_style = str(options.get("markupStyle", "none"))

    with Image.open(input_path) as image:
        image = image.convert("RGB")
        if markup_style.strip().lower() == "focus-ring":
            image = draw_focus_rings(image, points)
        left, top, right, bottom = crop_bounds(image.width, image.height, points, crop_mode)
        cropped = image.crop((left, top, right, bottom)).resize((image.width, image.height), Image.Resampling.LANCZOS)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        cropped.save(output_path, quality=95)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
