#!/usr/bin/env python3
"""Portrait renders for Cubs of Brutality.

The pixel-art portraits are made beforehand with an image model and kept in
the art library; this picks one render and writes it where the game expects it.

  python3 tools/portrait.py mayor --take a -o art/portraits/mayor_a.png
  python3 tools/portrait.py lumberjack --take v2 -o art/portraits/lumberjack.png
"""
import argparse, os, shutil, sys
from pathlib import Path

LIBRARY = Path(os.environ["DEMO_LIBRARY"])  # carpeta con los renders (fuera del repo)

p = argparse.ArgumentParser()
p.add_argument("name")
p.add_argument("--take", required=True)
p.add_argument("-o", "--out", required=True)
a = p.parse_args()
src = LIBRARY / f"{a.name}_{a.take}.png"
if not src.exists():
    sys.exit(f"no render for {a.name} take {a.take}")
Path(a.out).parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(src, a.out)
print(f"wrote {a.out}")
