"""Encode Blender knot frames into per-step MP4 clips plus a WebP poster.

Run after generate-knot-videos.py has rendered public/media/knots/_frames/<knot>/<knot>_0001.png
... <knot>_0576.png (three steps x 192 frames at 24 fps). Frames are deleted afterwards unless
--keep-frames is given. Requires ffmpeg on PATH (libx264 + libwebp).
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

FRAMES_PER_STEP, STEPS, FPS = 192, 3, 24

parser = argparse.ArgumentParser()
parser.add_argument('repo', type=Path, nargs='?', default=Path.cwd())
parser.add_argument('--knot')
parser.add_argument('--keep-frames', action='store_true')
options = parser.parse_args()
root = options.repo / 'public/media/knots'
frames_root = root / '_frames'
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    sys.exit('ffmpeg not found on PATH')

encoded = []
for knot_dir in sorted(p for p in frames_root.iterdir() if p.is_dir()):
    name = knot_dir.name
    if options.knot and name != options.knot:
        continue
    frames = sorted(knot_dir.glob(f'{name}_*.png'))
    if len(frames) != FRAMES_PER_STEP * STEPS:
        raise RuntimeError(f'{name}: expected {FRAMES_PER_STEP * STEPS} frames, found {len(frames)}')
    for step in range(STEPS):
        first = step * FRAMES_PER_STEP + 1
        # start_number + frames limits ffmpeg to this step's slice of the sequence.
        common = [ffmpeg, '-loglevel', 'error', '-y', '-framerate', str(FPS), '-start_number', str(first),
                  '-i', str(knot_dir / f'{name}_%04d.png'), '-frames:v', str(FRAMES_PER_STEP)]
        subprocess.run(common + ['-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-pix_fmt', 'yuv420p',
                                 '-movflags', '+faststart', '-an', str(root / f'{name}-step-{step + 1}.mp4')], check=True)
        # Poster = the completed stage, so reduced-motion and no-play viewers still see the result.
        subprocess.run([ffmpeg, '-loglevel', 'error', '-y', '-i', str(frames[first + FRAMES_PER_STEP - 2]),
                        '-c:v', 'libwebp', '-quality', '82', str(root / f'{name}-step-{step + 1}.webp')], check=True)
    encoded.append(name)
    if not options.keep_frames:
        shutil.rmtree(knot_dir)
if not options.keep_frames and frames_root.exists() and not any(frames_root.iterdir()):
    frames_root.rmdir()
print('encoded:', ', '.join(encoded) or 'nothing')
