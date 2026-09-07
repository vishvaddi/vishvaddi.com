import bpy
import re
import sys
from pathlib import Path
from mathutils import Vector


def cubic(a, b, c, d, t):
    u = 1 - t
    return u**3 * a + 3 * u**2 * t * b + 3 * u * t**2 * c + t**3 * d


def parse_path(value):
    tokens = re.findall(r"[MLC]|-?\d+(?:\.\d+)?", value)
    points, cursor, command, i = [], Vector((0.0, 0.0)), None, 0
    while i < len(tokens):
        if tokens[i] in {"M", "L", "C"}:
            command = tokens[i]
            i += 1
        if command in {"M", "L"}:
            cursor = Vector((float(tokens[i]), float(tokens[i + 1])))
            points.append(cursor.copy())
            i += 2
            command = "L"
        elif command == "C":
            b = Vector((float(tokens[i]), float(tokens[i + 1])))
            c = Vector((float(tokens[i + 2]), float(tokens[i + 3])))
            d = Vector((float(tokens[i + 4]), float(tokens[i + 5])))
            a = cursor.copy()
            points.extend(Vector((cubic(a.x, b.x, c.x, d.x, t), cubic(a.y, b.y, c.y, d.y, t))) for t in [n / 28 for n in range(1, 29)])
            cursor = d
            i += 6
        else:
            raise ValueError(f"Unsupported path near {tokens[i:]}")
    return [((p.x - 106) / 22, (68 - p.y) / 22, 0.25) for p in points]


def material(name, colour, roughness=0.48):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1)
    mat.roughness = roughness
    return mat


def curve_object(name, points, mat):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 3
    curve.bevel_depth = 0.13
    curve.bevel_resolution = 4
    curve.resolution_u = 4
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coords in zip(spline.points, points):
        point.co = (*coords, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def build_scene(knot_name, paths, output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.render.resolution_x = 480
    scene.render.resolution_y = 306
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.frame_start = 1
    scene.frame_end = 216
    scene.render.image_settings.file_format = "PNG"
    frame_dir = output.parent / "_frames" / output.stem
    frame_dir.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(frame_dir / f"{output.stem}_")
    scene.world = bpy.data.worlds.new("World")
    scene.world.color = (0.025, 0.03, 0.035)

    rope_mat = material("Safety orange rope", (0.9, 0.19, 0.045), 0.55)
    plane_mat = material("Slate", (0.055, 0.068, 0.078), 0.82)
    text_mat = material("Text", (0.75, 0.8, 0.83), 0.7)

    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, 0))
    bpy.context.object.data.materials.append(plane_mat)

    camera_data = bpy.data.cameras.new("Camera")
    camera = bpy.data.objects.new("Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0, 0, 15)
    camera.rotation_euler = (0, 0, 0)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 10.5
    scene.camera = camera

    light_data = bpy.data.lights.new("Softbox", "AREA")
    light_data.energy = 900
    light_data.shape = "DISK"
    light_data.size = 8
    light = bpy.data.objects.new("Softbox", light_data)
    bpy.context.collection.objects.link(light)
    light.location = (-3, -4, 9)

    title_curve = bpy.data.curves.new("Title", "FONT")
    title_curve.body = knot_name.replace("-", " ").title()
    title_curve.align_x = "CENTER"
    title_curve.size = 0.44
    title_obj = bpy.data.objects.new("Title", title_curve)
    bpy.context.collection.objects.link(title_obj)
    title_obj.location = (0, 3.8, 0.3)
    title_obj.data.materials.append(text_mat)

    for index, path in enumerate(paths):
        start = 1 + index * 72
        end = start + 54
        last = start + 71
        obj = curve_object(f"Step {index + 1}", parse_path(path), rope_mat)
        obj.data.bevel_factor_end = 0
        obj.data.keyframe_insert("bevel_factor_end", frame=start)
        obj.data.bevel_factor_end = 1
        obj.data.keyframe_insert("bevel_factor_end", frame=end)
        obj.hide_render = True
        obj.keyframe_insert("hide_render", frame=max(1, start - 1))
        obj.hide_render = False
        obj.keyframe_insert("hide_render", frame=start)
        obj.keyframe_insert("hide_render", frame=last)
        if last < scene.frame_end:
            obj.hide_render = True
            obj.keyframe_insert("hide_render", frame=last + 1)

        label_curve = bpy.data.curves.new(f"Step label {index + 1}", "FONT")
        label_curve.body = f"STEP {index + 1} OF {len(paths)}"
        label_curve.align_x = "CENTER"
        label_curve.size = 0.34
        label_obj = bpy.data.objects.new(f"Step label {index + 1}", label_curve)
        bpy.context.collection.objects.link(label_obj)
        label_obj.location = (0, -3.85, 0.3)
        label_obj.data.materials.append(text_mat)
        label_obj.hide_render = True
        label_obj.keyframe_insert("hide_render", frame=max(1, start - 1))
        label_obj.hide_render = False
        label_obj.keyframe_insert("hide_render", frame=start)
        label_obj.keyframe_insert("hide_render", frame=last)
        if last < scene.frame_end:
            label_obj.hide_render = True
            label_obj.keyframe_insert("hide_render", frame=last + 1)

    bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix(".blend")))
    bpy.ops.render.render(animation=True)


repo = Path(sys.argv[sys.argv.index("--") + 1]) if "--" in sys.argv else Path.cwd()
source = (repo / "src/pages/prepping/knots.astro").read_text(encoding="utf-8")
blocks = re.findall(r'id: "([^"]+)"[\s\S]*?steps: \[([\s\S]*?)\n    \],', source)
output_dir = repo / "public/media/knots"
output_dir.mkdir(parents=True, exist_ok=True)
for knot_name, block in blocks:
    paths = re.findall(r'\["[^"]*", "([^"]+)"\]', block)
    if len(paths) != 3:
        raise RuntimeError(f"Expected three steps for {knot_name}, found {len(paths)}")
    build_scene(knot_name, paths, output_dir / f"{knot_name}.mp4")
