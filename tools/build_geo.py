"""Build Albers-projected SVG geometry for the ATLAS map.

Run once, offline, before deploying:

    python tools/build_geo.py --src vendor --out assets/geo/geo.js

Input  : us-states.js GeoJSON (public-domain Census-derived, simplified)
         us-roads-2025.json (Census TIGER/Line 2025 primary + primary/secondary)
Output : geo.js  ->  window.ATLAS_GEO = {vb, states:[...], roads:{...}, places:[...]}

The projection is Albers equal-area conic (CONUS standard parallels 29.5/45.5,
central meridian -96, origin 37.5) on a sphere. It is precomputed so the browser
only has to apply pan/zoom transforms.

The generated assets/geo/geo.js is committed, so rebuilding is optional.
"""
import argparse
import json
import math
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.environ.get("ATLAS_SRC", os.path.join(_HERE, "vendor"))
OUT = os.environ.get("ATLAS_OUT", os.path.join(_HERE, "..", "assets", "geo", "geo.js"))

R = 6378137.0
LAT1, LAT2 = math.radians(29.5), math.radians(45.5)
LAT0, LON0 = math.radians(37.5), math.radians(-96.0)
N = (math.sin(LAT1) + math.sin(LAT2)) / 2.0
C = math.cos(LAT1) ** 2 + 2 * N * math.sin(LAT1)
RHO0 = R * math.sqrt(C - 2 * N * math.sin(LAT0)) / N
THETA0 = 0.0


def albers(lon, lat):
    lat_r, lon_r = math.radians(lat), math.radians(lon)
    rho = R * math.sqrt(C - 2 * N * math.sin(lat_r)) / N
    theta = N * (lon_r - LON0)
    x = rho * math.sin(theta)
    y = RHO0 - rho * math.cos(theta)
    return x, y


# ---- projection fitted to the CONUS state outlines -----------------------
PAD = 6.0
VB_W = 1000.0
CONUS_SKIP = {"AK", "HI", "PR", "VI", "GU", "AS", "MP"}

_STATE_GEO = None


def _load_states():
    global _STATE_GEO
    if _STATE_GEO is not None:
        return _STATE_GEO
    txt = open(os.path.join(SRC, "us-states.js"), encoding="utf-8").read()
    m = re.search(r"=\s*(\{.*\})", txt, re.S)
    _STATE_GEO = json.loads(m.group(1))
    return _STATE_GEO


def fit():
    xs, ys = [], []
    for f in _load_states()["features"]:
        abbr = f["properties"].get("abbr") or f["properties"].get("STUSPS") or ""
        if abbr in CONUS_SKIP:
            continue
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        for poly in polys:
            for lon, lat in poly[0]:
                if lon < -140 or lat < 22:
                    continue
                x, y = albers(lon, lat)
                xs.append(x); ys.append(y)
    return min(xs), max(xs), min(ys), max(ys)

MINX = MAXX = MINY = MAXY = 0.0
SCALE = 1.0
VB_H = 1.0


def init_frame():
    """Fit the Albers projection to the CONUS outlines (needs --src applied first)."""
    global MINX, MAXX, MINY, MAXY, SCALE, VB_H
    MINX, MAXX, MINY, MAXY = fit()
    SCALE = (VB_W - 2 * PAD) / (MAXX - MINX)
    VB_H = round((MAXY - MINY) * SCALE + 2 * PAD, 1)


def project(lon, lat):
    x, y = albers(lon, lat)
    px = (x - MINX) * SCALE + PAD
    # SVG y grows downward; Albers y grows northward -> flip
    py = (MAXY - y) * SCALE + PAD
    return px, py


# ---- Douglas-Peucker on screen coords ------------------------------------
def simplify(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1:
            continue
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay
        den = dx * dx + dy * dy
        best, bi = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if den == 0:
                d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / den))
                qx, qy = ax + t * dx, ay + t * dy
                d = (px - qx) ** 2 + (py - qy) ** 2
            if d > best:
                best, bi = d, i
        if best > tol * tol:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, k in zip(pts, keep) if k]


def path_from_latlng(coords, tol):
    pts = [project(lon, lat) for lon, lat in coords]
    pts = simplify(pts, tol)
    if len(pts) < 2:
        return ""
    out = ["M%.1f %.1f" % pts[0]]
    for i in range(1, len(pts)):
        out.append("%.1f %.1f" % pts[i])
    # single sub-path: "M x y L x y L ..." compressed as "M x y x y ..."
    head = out[0]
    tail = " ".join(p if " " in p and not p.startswith("M") else p for p in out[1:])
    return head + " " + tail


def ring_path(ring, tol):
    pts = [project(lon, lat) for lon, lat in ring]
    pts = simplify(pts, tol)
    if len(pts) < 3:
        return ""
    d = "M%.1f %.1f" % pts[0]
    for i in range(1, len(pts)):
        d += " %.1f %.1f" % pts[i]
    return d + "Z"


# ---- decode the road polylines (Google encoding, precision 1e-4) --------
def decode(poly, precision=1e4):
    idx = lat = lng = 0
    coords = []
    while idx < len(poly):
        shift = result = 0
        while True:
            b = ord(poly[idx]) - 63
            idx += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlat = ~(result >> 1) if result & 1 else (result >> 1)
        lat += dlat
        shift = result = 0
        while True:
            b = ord(poly[idx]) - 63
            idx += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        dlng = ~(result >> 1) if result & 1 else (result >> 1)
        lng += dlng
        coords.append((lng / precision, lat / precision))
    return coords


def main():
    init_frame()
    states_raw = open(os.path.join(SRC, "us-states.js"), encoding="utf-8").read()
    m = re.search(r"var US_STATES\s*=\s*(\{.*\});?\s*$", states_raw.strip(), re.S)
    if not m:
        m = re.search(r"=\s*(\{.*\})", states_raw, re.S)
    geo = json.loads(m.group(1))

    states = []
    for f in geo["features"]:
        name = f["properties"].get("name") or f["properties"].get("NAME")
        abbr = f["properties"].get("abbr") or f["properties"].get("STUSPS")
        if abbr in CONUS_SKIP:
            continue
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        d = ""
        for poly in polys:
            for ring in poly[:1]:
                if any(lon < -140 for lon, _ in ring):
                    continue
                d += ring_path(ring, 0.5)
        if not d:
            continue
        # label anchor = first ring centroid (bbox centre of largest ring)
        biggest, bx, by, bn = None, 0, 0, -1
        for poly in polys:
            ring = poly[0]
            xs = [project(c[0], c[1])[0] for c in ring]
            ys = [project(c[0], c[1])[1] for c in ring]
            if len(ring) > bn:
                bn = len(ring)
                biggest = ring
                bx = (min(xs) + max(xs)) / 2
                by = (min(ys) + max(ys)) / 2
        states.append({"a": abbr, "n": name, "d": d, "x": round(bx, 1), "y": round(by, 1)})

    roads_raw = json.load(open(os.path.join(SRC, "us-roads-2025.json"), encoding="utf-8"))
    buckets = {}
    for ref, cls, enc in roads_raw["roads"]:
        try:
            coords = decode(enc)
        except Exception:
            continue
        if len(coords) < 2:
            continue
        ref = str(ref or "")
        if ref.startswith("I-"):
            kind, tol = "inter", 0.7
        elif ref.startswith("US-") or ref.startswith("US "):
            kind, tol = "us", 0.9
        else:
            kind, tol = "other", 1.1
        p = path_from_latlng(coords, tol)
        if p:
            buckets.setdefault(kind, []).append(p)
    roads = {"inter": "", "us": "", "other": ""}
    for k, v in buckets.items():
        roads[k] = "".join(v)

    places = []
    for item in roads_raw["cities"]:
        if len(item) < 3:
            continue
        nm, lat, lon = item[0], item[1], item[2]
        w = item[3] if len(item) > 3 else 4.4
        x, y = project(lon, lat)
        places.append({"n": nm, "x": round(x, 1), "y": round(y, 1), "w": w})
    # rank places by importance weight, keep the readable ones
    places.sort(key=lambda p: -p["w"])
    places = places[:70]

    out = {
        "vb": [0, 0, VB_W, VB_H],
        "proj": {"scale": SCALE, "minx": MINX, "maxy": MAXY, "pad": PAD,
                 "lat1": 29.5, "lat2": 45.5, "lat0": 37.5, "lon0": -96.0},
        "states": states,
        "roads": roads,
        "places": places,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write("window.ATLAS_GEO=")
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    print("states", len(states), "roadpaths", {k: len(v) for k, v in roads.items()},
          "places", len(places), "bytes", os.path.getsize(OUT), "vh", VB_H)


def preview(roads_raw):
    """Optional raster sanity check of the projection."""
    from PIL import Image, ImageDraw
    S = 2.0
    img = Image.new("RGB", (int(VB_W * S), int(VB_H * S)), (10, 17, 28))
    d = ImageDraw.Draw(img)
    for ref, cls, enc in roads_raw["roads"]:
        try:
            coords = decode(enc)
        except Exception:
            continue
        if len(coords) < 2:
            continue
        pts = [project(lon, lat) for lon, lat in coords]
        col = (60, 80, 110) if str(ref).startswith("I-") else (34, 48, 66)
        d.line([(x * S, y * S) for x, y in pts], fill=col, width=1)
    out_png = os.path.join(os.path.dirname(os.path.abspath(OUT)), "geo-preview.png")
    img.save(out_png)
    print("preview ->", out_png)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Build ATLAS map geometry")
    ap.add_argument("--src", default=SRC, help="directory holding us-states.js and us-roads-2025.json")
    ap.add_argument("--out", default=OUT, help="output geo.js path")
    ap.add_argument("--preview", action="store_true", help="also write a PNG sanity check (needs Pillow)")
    a = ap.parse_args()
    SRC = a.src
    OUT = a.out
    main()
    if a.preview:
        preview(json.load(open(os.path.join(SRC, "us-roads-2025.json"), encoding="utf-8")))

