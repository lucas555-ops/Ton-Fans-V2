#!/usr/bin/env python3  

""" 
Split a big mixed collection into 4 Candy Machine asset folders.

Expected inputs (you decide your structure):
- Source folders for each tier (recommended):
  ./SOURCE/LittlGEN/*.png + *.json (500)
  ./SOURCE/BigGEN/*.png + *.json (500)
  ./SOURCE/LittlGENdiamond/*.png + *.json (185)
  ./SOURCE/BigGENdiamond/*.png + *.json (85)

Output:
  ./OUT/cm-lgen/assets/0.png..499.png + 0.json..499.json
  ./OUT/cm-bgen/assets/0.png..499.png + 0.json..499.json
  ./OUT/cm-ldia/assets/0.png..184.png + 0.json..184.json
  ./OUT/cm-bdia/assets/0.png..84.png + 0.json..84.json

Usage:
  python split_assets_4cm.py --src ./SOURCE --out ./OUT

You can adapt folder names via args.
"""
import argparse, os, shutil, re
from pathlib import Path

def natural_key(s):
  return [int(t) if t.isdigit() else t.lower() for t in re.split(r'(\d+)', s)]

def copy_set(src_dir: Path, out_dir: Path, count: int):
  pngs = sorted(src_dir.glob("*.png"), key=lambda p: natural_key(p.name))
  jsons = sorted(src_dir.glob("*.json"), key=lambda p: natural_key(p.name))
  if len(pngs) < count or len(jsons) < count:
    raise SystemExit(f"Not enough files in {src_dir}: png={len(pngs)} json={len(jsons)} need={count}")
  out_dir.mkdir(parents=True, exist_ok=True)
  for i in range(count):
    shutil.copy2(pngs[i], out_dir / f"{i}.png")
    shutil.copy2(jsons[i], out_dir / f"{i}.json")
  print(f"OK: {src_dir.name} -> {out_dir} ({count})")

def main():
  ap = argparse.ArgumentParser()
  ap.add_argument("--src", required=True, help="Source root folder containing tier folders")
  ap.add_argument("--out", required=True, help="Output root folder")
  ap.add_argument("--lgen", default="LittlGEN")
  ap.add_argument("--bgen", default="BigGEN")
  ap.add_argument("--ldia", default="LittlGENdiamond")
  ap.add_argument("--bdia", default="BigGENdiamond")
  args = ap.parse_args()

  src = Path(args.src)
  out = Path(args.out)

  mapping = [
    (args.lgen, out/"cm-lgen"/"assets", 500),
    (args.bgen, out/"cm-bgen"/"assets", 500),
    (args.ldia, out/"cm-ldia"/"assets", 185),
    (args.bdia, out/"cm-bdia"/"assets", 85),
  ]
  for folder, outdir, count in mapping:
    copy_set(src/folder, outdir, count)

if __name__ == "__main__":
  main()
