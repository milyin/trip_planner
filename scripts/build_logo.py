#!/usr/bin/env python3
from dataclasses import dataclass
from math import hypot
from pathlib import Path

FG = "#25527a"

STROKE = 11.0
UNDER_STROKE = 21.0


@dataclass(frozen=True)
class Point:
    x: float
    y: float

    def __add__(self, other: "Point") -> "Point":
        return Point(self.x + other.x, self.y + other.y)

    def __sub__(self, other: "Point") -> "Point":
        return Point(self.x - other.x, self.y - other.y)

    def scale(self, factor: float) -> "Point":
        return Point(self.x * factor, self.y * factor)


def unit(vector: Point) -> Point:
    length = hypot(vector.x, vector.y)
    return Point(vector.x / length, vector.y / length)


def midpoint(a: Point, b: Point) -> Point:
    return Point((a.x + b.x) / 2, (a.y + b.y) / 2)


def n(value: float) -> str:
    return f"{value:.1f}"


def p(point: Point) -> str:
    return f"{n(point.x)} {n(point.y)}"


def build_svg() -> str:
    tail = Point(69.5, 107.0)
    back = Point(105.5, 169.7)
    nose = Point(370.8, 92.6)

    # Move both wings slightly toward the nose and define wing alignment from geometry.
    lwing = Point(154.3 + 8.0, 50.6)
    tail_to_back = back - tail
    rwing = lwing + tail_to_back.scale(2.4)  # RWing-LWing is parallel to Tail-Back.

    # Curve the wing connection toward the nose.
    wing_mid = midpoint(lwing, rwing)
    wing_ctrl = wing_mid + unit(nose - wing_mid).scale(70.0)

    # Slightly tighter Nose-Back arc radius.
    body_ctrl = Point(227.0, 89.0)

    outer_nodes = (
        (tail, 18.8),
        (back, 19.0),
        (lwing, 18.8),
        (rwing, 18.8),
        (nose, 18.3),
    )
    inner_nodes = (
        (tail, 13.8),
        (back, 14.0),
        (lwing, 13.8),
        (rwing, 13.8),
        (nose, 13.3),
    )

    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 414 268" width="414" height="268">',
        "  <defs>",
        '    <mask id="node-gaps" maskUnits="userSpaceOnUse">',
        '      <rect x="0" y="0" width="414" height="268" fill="white"/>',
    ]

    for point, radius in outer_nodes:
        lines.append(
            f'      <circle cx="{n(point.x)}" cy="{n(point.y)}" r="{n(radius)}" fill="black"/>'
        )

    lines.extend(
        [
            "    </mask>",
            '    <mask id="under-crossing" maskUnits="userSpaceOnUse">',
            '      <rect x="0" y="0" width="414" height="268" fill="white"/>',
        ]
    )

    for point, radius in outer_nodes:
        lines.append(
            f'      <circle cx="{n(point.x)}" cy="{n(point.y)}" r="{n(radius)}" fill="black"/>'
        )

    lines.extend(
        [
            f'      <path d="M {p(back)} Q {p(body_ctrl)} {p(nose)}" fill="none" stroke="black" stroke-width="{n(UNDER_STROKE)}" stroke-linecap="round" stroke-linejoin="round"/>',
            "    </mask>",
            "  </defs>",
            '  <g mask="url(#under-crossing)">',
            f'    <path d="M {p(tail)} L {p(back)}" fill="none" stroke="{FG}" stroke-width="{n(STROKE)}" stroke-linecap="round" stroke-linejoin="round"/>',
            f'    <path d="M {p(lwing)} Q {p(wing_ctrl)} {p(rwing)}" fill="none" stroke="{FG}" stroke-width="{n(STROKE)}" stroke-linecap="round" stroke-linejoin="round"/>',
            "  </g>",
            f'  <path d="M {p(back)} Q {p(body_ctrl)} {p(nose)}" fill="none" stroke="{FG}" stroke-width="{n(STROKE)}" stroke-linecap="round" stroke-linejoin="round" mask="url(#node-gaps)"/>',
        ]
    )

    for point, radius in inner_nodes:
        lines.append(f'  <circle cx="{n(point.x)}" cy="{n(point.y)}" r="{n(radius)}" fill="{FG}"/>')

    lines.append("</svg>")
    return "\n".join(lines) + "\n"


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    svg = build_svg()
    for relative_target in ("public/logo.svg", "public/favicon.svg"):
        (repo_root / relative_target).write_text(svg, encoding="utf-8")
    print("Wrote public/logo.svg and public/favicon.svg")


if __name__ == "__main__":
    main()
