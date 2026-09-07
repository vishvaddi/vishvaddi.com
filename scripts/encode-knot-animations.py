from pathlib import Path
from PIL import Image
import shutil
import sys


repo = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.cwd()
root = repo / "public/media/knots"
frames_root = root / "_frames"
for knot_dir in frames_root.iterdir():
    frames = sorted(knot_dir.glob("*.png"))
    if len(frames) != 216:
        raise RuntimeError(f"Expected 216 frames for {knot_dir.name}, found {len(frames)}")
    for step in range(3):
        selected = frames[step * 72:(step + 1) * 72]
        images = [Image.open(path).convert("RGB") for path in selected]
        target = root / f"{knot_dir.name}-step-{step + 1}.webp"
        images[0].save(target, save_all=True, append_images=images[1:], duration=42, loop=0, quality=78, method=6)
        for image in images:
            image.close()
shutil.rmtree(frames_root)
