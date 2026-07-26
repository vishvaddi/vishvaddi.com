import json
import sys
from pathlib import Path

import bpy


def arguments():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(args) != 2:
        raise SystemExit("usage: blender -b nereid-ii.blend --python scripts/deep-swarm-blender-export.py -- CONTRACT OUTPUT_DIR")
    return Path(args[0]).resolve(), Path(args[1]).resolve()


contract_path, output_dir = arguments()
contract = json.loads(contract_path.read_text(encoding="utf-8"))
output_dir.mkdir(parents=True, exist_ok=True)

missing_sockets = [
    blender_name
    for blender_name in contract["sockets"].values()
    if bpy.data.objects.get(blender_name) is None
]
available_actions = {action.name for action in bpy.data.actions}
missing_actions = [
    action
    for action in contract["animations"]
    if action not in available_actions
]
if missing_sockets or missing_actions:
    details = []
    if missing_sockets:
        details.append("missing sockets: " + ", ".join(missing_sockets))
    if missing_actions:
        details.append("missing actions: " + ", ".join(missing_actions))
    raise SystemExit("; ".join(details))

bpy.ops.export_scene.gltf(
    filepath=str(output_dir / contract["exports"]["interactive"]),
    export_format="GLB",
    export_animations=True,
    export_apply=True,
)
