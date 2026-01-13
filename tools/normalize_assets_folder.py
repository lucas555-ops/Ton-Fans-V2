#!/usr/bin/env python3
import argparse, json, re, shutil
from pathlib import Path

NUM_RE = re.compile(r"(\d+)(?=\.(png|json)$)", re.IGNORECASE)

def extract_num(p: Path) -> int:
    m = NUM_RE.search(p.name)
    if not m:
        raise ValueError(f"Can't extract number from: {p.name}")
    return int(m.group(1))

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--images", required=True, help="Folder with PNGs (any names, but with numbers)")
    ap.add_argument("--meta", required=False, help="Folder with JSON metadata (any names, but with numbers). If omitted, use images folder.")
    ap.add_argument("--out", required=True, help="Output folder (will contain 0.png/0.json ...)")
    ap.add_argument("--start", type=int, default=1, help="Start index in your filenames (default 1)")
    args = ap.parse_args()

    img_dir = Path(args.images)
    meta_dir = Path(args.meta) if args.meta else img_dir
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    pngs = sorted(img_dir.glob("*.png"), key=extract_num)
    if not pngs:
        raise SystemExit(f"No PNGs found in {img_dir}")

    # map old_num -> png path
    png_map = {extract_num(p): p for p in pngs}

    # json map (optional but strongly recommended)
    jsons = list(meta_dir.glob("*.json"))
    json_map = {extract_num(p): p for p in jsons} if jsons else {}

    missing_json = []
    written = 0

    for old_num in sorted(png_map.keys()):
        new_num = old_num - args.start
        if new_num < 0:
            raise SystemExit(f"Found old_num={old_num} < start={args.start}. Set --start correctly.")

        # copy png
        shutil.copy2(png_map[old_num], out_dir / f"{new_num}.png")

        # copy/patch json if exists
        if old_num in json_map:
            data = json.loads(json_map[old_num].read_text(encoding="utf-8"))
            # Make sugar-friendly: image + files uri -> "<new>.png"
            if isinstance(data.get("image"), str):
                data["image"] = f"{new_num}.png"
            props = data.get("properties")
            if isinstance(props, dict) and isinstance(props.get("files"), list):
                for f in props["files"]:
                    if isinstance(f, dict) and f.get("type", "").startswith("image/"):
                        f["uri"] = f"{new_num}.png"
            (out_dir / f"{new_num}.json").write_text(
                json.dumps(data, ensure_ascii=False, indent=2),
                encoding="utf-8"
            )
        else:
            missing_json.append(old_num)

        written += 1

    # sanity: contiguous 0..written-1
    expected_last = written - 1
    if not (out_dir / f"0.png").exists() or not (out_dir / f"{expected_last}.png").exists():
        raise SystemExit("Output is not contiguous from 0..N. Check filenames numbering.")

    print(f"OK: wrote {written} PNGs to {out_dir}")
    if missing_json:
        print(f"WARNING: missing JSON for {len(missing_json)} items (first 10): {missing_json[:10]}")

if __name__ == "__main__":
    main()
