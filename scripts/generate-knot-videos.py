import argparse
import bisect
import importlib.util
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.kdtree import KDTree


def smooth(points):
    points = [Vector(p) for i,p in enumerate(points) if i == 0 or (Vector(p)-Vector(points[i-1])).length > .00001]
    out = []
    for i in range(len(points)-1):
        a, b = points[max(0,i-1)], points[i]
        c, d = points[i+1], points[min(len(points)-1,i+2)]
        span = (c-b).length
        left = b+(c-a).normalized()*min(span,(b-a).length if i else span)/3
        right = c-(d-b).normalized()*min(span,(d-c).length if i<len(points)-2 else span)/3
        for j in range(10):
            t = j/10
            u = 1-t
            out.append(tuple(u*u*u*b+3*u*u*t*left+3*u*t*t*right+t*t*t*c))
    return out+[tuple(points[-1])]


def material(name, colour):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour,1)
    return mat


def sample_route(groups):
    raw, cuts = [],[]
    for group in groups:
        for p in group:
            if not raw or (Vector(p)-Vector(raw[-1])).length > .00001: raw.append(p)
        cuts.append((len(raw)-1)*10)
    return smooth(raw), cuts


def audit(name, groups, fixed, anchors):
    points, _ = sample_route(groups)
    lengths = [0]
    for a,b in zip(points,points[1:]): lengths.append(lengths[-1]+(Vector(b)-Vector(a)).length)
    tree = KDTree(len(points))
    for i,p in enumerate(points): tree.insert(Vector(p),i)
    tree.balance()
    hits = []
    radius = .065 if name == 'square-lashing' else .085
    for i,p in enumerate(points):
        for _,j,distance in tree.find_range(Vector(p),radius*2):
            if j>i and lengths[j]-lengths[i]>.6:
                hits.append((round(distance,3),i,j,tuple(round(v,2) for v in p)))
    for strand in fixed:
        for p in smooth(strand):
            for _,j,distance in tree.find_range(Vector(p),radius+.14):
                hits.append((round(distance,3),'second rope',j,tuple(round(v,2) for v in p)))
    for kind,centre,size in anchors:
        axis = 2 if kind == 'post' else 1 if kind == 'upright' else 0
        for i,p in enumerate(points):
            v = Vector(p)-Vector(centre)
            radial = math.sqrt(sum(v[j]*v[j] for j in range(3) if j != axis))-size
            axial = abs(v[axis])-(.5 if kind == 'post' else 3.5)
            distance = math.hypot(max(0,radial),max(0,axial))+min(max(radial,axial),0)
            if distance < radius:
                hits.append((round(distance,3),kind,i,tuple(round(c,2) for c in p)))
    hits.sort(key=lambda hit: hit[0])
    print(name, 'clear' if not hits else f'{len(hits)} surface intersections; closest: {hits[:5]}',flush=True)
    return not hits


def rope(name, points, mat, radius=.1):
    curve = bpy.data.curves.new(name,'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    spline = curve.splines.new('POLY')
    spline.points.add(len(points)-1)
    for p,xyz in zip(spline.points,points): p.co = (*xyz,1)
    obj = bpy.data.objects.new(name,curve)
    bpy.context.collection.objects.link(obj)
    curve.materials.append(mat)
    return obj


def build(name, groups, fixed, anchors, root, preview):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.display.shading.background_type = 'WORLD'
    scene.world = bpy.data.worlds.new('World')
    scene.world.color = (.045,.06,.075)
    scene.render.resolution_x, scene.render.resolution_y = 720,480
    scene.render.resolution_percentage = 100
    scene.render.fps = 24
    scene.frame_start, scene.frame_end = 1,576
    scene.render.image_settings.file_format = 'PNG'
    scene.display.render_aa = '8'
    orange = material('Working rope',(.95,.28,.065))
    blue = material('Second rope',(.12,.55,.85))
    wood = material('Anchor',(.24,.28,.32))
    gold = material('Working end',(1,.8,.18))
    ground = material('Background',(.045,.06,.075))
    bpy.ops.mesh.primitive_plane_add(size=30,location=(0,0,-2.1))
    bpy.context.object.data.materials.append(ground)
    for kind,centre,radius in anchors:
        bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=radius,depth=7 if kind!='post' else 1,location=centre)
        obj = bpy.context.object
        if kind=='upright': obj.rotation_euler.x = math.pi/2
        if kind=='crossbar': obj.rotation_euler.y = math.pi/2
        obj.data.materials.append(wood)
    for i,strand in enumerate(fixed): rope(f'Separate rope {i}',smooth(strand),blue,.14)
    points,cuts = sample_route(groups)
    obj = rope('Continuous working rope',points,orange,.065 if name == 'square-lashing' else .085)
    lengths = [0]
    for a,b in zip(points,points[1:]): lengths.append(lengths[-1]+(Vector(b)-Vector(a)).length)
    obj.data.bevel_factor_mapping_end = 'SPLINE'
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,radius=.15)
    tip = bpy.context.object
    tip.name = 'Follow this working end'
    tip.data.materials.append(gold)
    for frame in range(1,577):
        step = min(2,(frame-1)//192)
        local = (frame-1)%192
        t = min(1,max(0,(local-24)/120))
        t = t*t*(3-2*t)
        start = cuts[step-1] if step else 0
        end = cuts[step]
        distance = lengths[start]+t*(lengths[end]-lengths[start])
        obj.data.bevel_factor_end = max(.0001,distance/lengths[-1])
        obj.data.keyframe_insert('bevel_factor_end',frame=frame)
        j = min(len(points)-2,max(0,bisect.bisect_right(lengths,distance)-1))
        f = (distance-lengths[j])/max(.00001,lengths[j+1]-lengths[j])
        tip.location = Vector(points[j]).lerp(Vector(points[j+1]),max(0,min(1,f)))
        tip.keyframe_insert('location',frame=frame)
    camera_data = bpy.data.cameras.new('Camera')
    camera = bpy.data.objects.new('Camera',camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (0,-3,18)
    camera.rotation_euler = (Vector((0,0,0))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 10
    scene.camera = camera
    output = root/'_frames'/name
    output.mkdir(parents=True,exist_ok=True)
    scene.render.filepath = str(output/f'{name}_')
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(root/f'{name}.blend'))
    if preview:
        for step in range(3):
            scene.frame_set((step+1)*192)
            scene.render.filepath = str(output/f'preview-{step+1}.png')
            bpy.ops.render.render(write_still=True)
    else:
        bpy.ops.render.render(animation=True)


parser = argparse.ArgumentParser()
parser.add_argument('repo',type=Path)
parser.add_argument('--knot')
parser.add_argument('--preview',action='store_true')
parser.add_argument('--audit',action='store_true')
options = parser.parse_args(sys.argv[sys.argv.index('--')+1:])
spec = importlib.util.spec_from_file_location('knot_models',options.repo/'scripts/knot-models.py')
models = importlib.util.module_from_spec(spec)
spec.loader.exec_module(models)
failed = False
for name,(groups,fixed,anchors) in models.lessons().items():
    if options.knot and name!=options.knot: continue
    if options.audit:
        failed = not audit(name,groups,fixed,anchors) or failed
        continue
    if not options.preview and not audit(name,groups,fixed,anchors):
        raise RuntimeError(f'{name}: rope geometry intersects; fix before rendering')
    build(name,groups,fixed,anchors,options.repo/'public/media/knots',options.preview)
if failed: raise RuntimeError('Knot geometry audit failed')
