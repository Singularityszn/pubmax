"""Circuit Fox, built by code: a 3-second Blender loop of the Pub Pal fox.

The fox is made from primitives (no sculpt, no master image), lit and animated
here, and rendered with Cycles on the CPU so it runs headless. The look follows
public/pal/circuit-fox-512.png: charcoal velvet, cyan eyes, pink cheeks, an
orange circuit glow on the chest with a brass pendant, glowing ear traces, a
dark glossy floor. The loop blinks, tilts the head, twitches an ear, breathes
and pulses the glow, and frame 73 equals frame 1, so it repeats without a jump.

Run (writes PNG frames to OUT_DIR):
  blender --background --factory-startup --python scripts/pubpal/blender/fox_loop.py -- OUT_DIR [SAMPLES] [SIZE] [FRAMES]
then scripts/pubpal/blender/encode_loop.sh OUT_DIR turns the frames into video.
"""

import math
import sys

import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else "/tmp/fox"
SAMPLES = int(argv[1]) if len(argv) > 1 else 48
SIZE = int(argv[2]) if len(argv) > 2 else 512
# "all" renders the loop; a number renders that one frame (for a quick look).
FRAMES = argv[3] if len(argv) > 3 else "all"

LOOP = 72  # frames, at 24 fps: 3 seconds
FPS = 24

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


# ---------- materials ---------------------------------------------------------

def principled(name, colour, roughness=0.5, metallic=0.0, sheen=0.0, emission=None, strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if sheen:
        bsdf.inputs["Sheen Weight"].default_value = sheen
        bsdf.inputs["Sheen Roughness"].default_value = 0.4
        bsdf.inputs["Sheen Tint"].default_value = (0.55, 0.6, 0.7, 1.0)
    if emission:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return mat


def glow(name, colour, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    em = nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = (*colour, 1.0)
    em.inputs["Strength"].default_value = strength
    mat.node_tree.links.new(em.outputs["Emission"], out.inputs["Surface"])
    return mat, em


FUR = principled("fur", (0.018, 0.019, 0.024), roughness=0.85, sheen=1.0)
NOSE = principled("nose", (0.01, 0.01, 0.012), roughness=0.25)
PUPIL = principled("pupil", (0.0, 0.0, 0.0), roughness=0.1)
BRASS = principled("brass", (0.75, 0.48, 0.2), roughness=0.35, metallic=0.35, emission=(0.9, 0.55, 0.2), strength=0.25)
CORD = principled("cord", (0.02, 0.02, 0.02), roughness=0.6)
FLOOR = principled("floor", (0.006, 0.008, 0.011), roughness=0.45)
CHEEK, _ = glow("cheek", (0.95, 0.25, 0.3), 0.6)
EYE, EYE_GLOW = glow("eye", (0.1, 0.85, 0.95), 7.0)
CHEST, CHEST_GLOW = glow("chest", (1.0, 0.25, 0.08), 3.0)
TRACE, TRACE_GLOW = glow("trace", (1.0, 0.42, 0.12), 5.0)


# ---------- helpers -----------------------------------------------------------

def sphere(name, loc, scale, mat, parent=None, segments=48):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=segments // 2, location=loc)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def tube(name, points, radius, mat, parent=None):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 4
    curve.use_fill_caps = True
    spline = curve.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1.0)
    obj = bpy.data.objects.new(name, curve)
    obj.data.materials.append(mat)
    bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def empty(name, loc, parent=None):
    obj = bpy.data.objects.new(name, None)
    obj.location = loc
    bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
        obj.matrix_parent_inverse = parent.matrix_world.inverted()
    return obj


def key(obj, path, frame, value, index=-1):
    setattr_path = getattr(obj, path)
    if index >= 0:
        setattr_path[index] = value
    else:
        setattr(obj, path, value)
    obj.keyframe_insert(data_path=path, frame=frame, index=index)


# ---------- body --------------------------------------------------------------

root = empty("fox", (0, 0, 0))
body = sphere("body", (0, 0, 0.62), (0.55, 0.48, 0.66), FUR, root)
base = sphere("haunch", (0, -0.02, 0.3), (0.68, 0.6, 0.34), FUR, root)
for side in (-1, 1):
    sphere(f"paw_{side}", (0.17 * side, -0.42, 0.08), (0.12, 0.16, 0.08), FUR, root)

# The tail curls round the front, as in the master.
tail_points = []
for i in range(14):
    t = i / 13
    angle = math.radians(-60 + 200 * t)
    tail_points.append((0.72 * math.cos(angle), -0.62 * math.sin(angle) + 0.05, 0.1 + 0.05 * math.sin(t * math.pi)))
tail = tube("tail", tail_points, 0.14, FUR, root)
tail.data.taper_object = None

# Chest glow: a flattened teardrop just proud of the chest, plus circuit traces.
chest = sphere("chest", (0, -0.465, 0.6), (0.17, 0.04, 0.26), CHEST, root)
for points in (
    [(-0.06, -0.505, 0.75), (-0.06, -0.51, 0.62), (-0.12, -0.5, 0.55)],
    [(0.05, -0.505, 0.78), (0.05, -0.51, 0.58), (0.11, -0.5, 0.5)],
    [(0.0, -0.51, 0.7), (0.0, -0.512, 0.47)],
):
    tube("chest_trace", points, 0.006, TRACE, root)

# Floor traces, the glowing lines on the ground in front of the fox.
for points in (
    [(-0.9, -0.75, 0.003), (-0.35, -0.75, 0.003), (-0.25, -0.65, 0.003), (0.3, -0.65, 0.003)],
    [(0.2, -0.85, 0.003), (0.6, -0.85, 0.003), (0.7, -0.75, 0.003), (1.0, -0.75, 0.003)],
):
    tube("floor_trace", points, 0.008, TRACE, None)

# Pendant on a cord.
pendant = empty("pendant", (0, -0.53, 0.63), root)
tube("cord", [(-0.22, -0.36, 0.98), (-0.07, -0.5, 0.74), (0, -0.53, 0.67), (0.07, -0.5, 0.74), (0.22, -0.36, 0.98)], 0.008, CORD, root)
bpy.ops.mesh.primitive_cylinder_add(radius=0.065, depth=0.02, location=(0, -0.545, 0.6), rotation=(math.radians(90), 0, 0))
disc = bpy.context.object
disc.data.materials.append(BRASS)
disc.parent = pendant
disc.matrix_parent_inverse = pendant.matrix_world.inverted()
bpy.ops.object.shade_smooth()

# ---------- head --------------------------------------------------------------

neck = empty("neck", (0, -0.05, 1.12), root)
head = sphere("head", (0, -0.08, 1.38), (0.46, 0.4, 0.38), FUR, neck)
for side in (-1, 1):
    sphere(f"cheek_fluff_{side}", (0.36 * side, -0.14, 1.26), (0.2, 0.17, 0.14), FUR, neck)
    sphere(f"cheek_{side}", (0.25 * side, -0.405, 1.27), (0.07, 0.02, 0.05), CHEEK, neck)
snout = sphere("snout", (0, -0.5, 1.26), (0.12, 0.2, 0.09), FUR, neck)
sphere("nose", (0, -0.695, 1.29), (0.04, 0.03, 0.032), NOSE, neck)

eyes = []
for side in (-1, 1):
    eye = empty(f"eye_{side}", (0.16 * side, -0.45, 1.43), neck)
    sphere(f"iris_{side}", (0.16 * side, -0.45, 1.43), (0.08, 0.04, 0.08), EYE, eye)
    sphere(f"pupil_{side}", (0.16 * side, -0.485, 1.43), (0.042, 0.012, 0.05), PUPIL, eye)
    eyes.append(eye)

ears = []
for side in (-1, 1):
    pivot = empty(f"ear_pivot_{side}", (0.27 * side, -0.05, 1.62), neck)
    bpy.ops.mesh.primitive_cone_add(vertices=32, radius1=0.19, radius2=0.01, depth=0.5,
                                    location=(0.33 * side, -0.05, 1.86),
                                    rotation=(0, math.radians(18 * side), 0))
    ear = bpy.context.object
    ear.name = f"ear_{side}"
    ear.scale = (1.0, 0.55, 1.0)
    ear.data.materials.append(FUR)
    bpy.ops.object.shade_smooth()
    ear.parent = pivot
    ear.matrix_parent_inverse = pivot.matrix_world.inverted()
    # Ear traces, three short glowing lines on the front face of each ear.
    for j in range(3):
        x0 = 0.27 * side + 0.035 * (j - 1)
        tube(f"ear_trace_{side}_{j}", [(x0, -0.13, 1.7), (x0 + 0.03 * side, -0.12, 1.82 - 0.02 * j), (x0 + 0.06 * side, -0.1, 1.9 - 0.04 * j)], 0.005, TRACE, pivot)
    ears.append(pivot)

# ---------- floor, world, lights, camera --------------------------------------

bpy.ops.mesh.primitive_plane_add(size=12, location=(0, 0, 0))
bpy.context.object.data.materials.append(FLOOR)

world = bpy.data.worlds.new("night")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.004, 0.008, 0.014, 1.0)
bg.inputs["Strength"].default_value = 1.0


def area_light(name, loc, target, energy, colour, size):
    bpy.ops.object.light_add(type="AREA", location=loc)
    light = bpy.context.object
    light.name = name
    light.data.energy = energy
    light.data.color = colour
    light.data.size = size
    direction = Vector(target) - Vector(loc)
    light.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    return light


area_light("key", (-2.6, -2.2, 3.6), (0, 0, 1.0), 120, (1.0, 0.92, 0.85), 1.5)
area_light("rim_cyan", (2.0, 1.8, 2.2), (0, 0, 1.1), 420, (0.35, 0.75, 1.0), 1.5)
area_light("rim_warm", (-1.8, 1.6, 1.4), (0, 0, 0.8), 160, (1.0, 0.5, 0.25), 1.2)

bpy.ops.object.camera_add(location=(1.25, -4.4, 1.45))
camera = bpy.context.object
camera.data.lens = 50
camera.rotation_euler = (Vector((0, 0, 0.98)) - camera.location).to_track_quat("-Z", "Y").to_euler()
scene.camera = camera

# ---------- animation (a seamless 72-frame loop) ------------------------------

scene.frame_start = 1
scene.frame_end = LOOP
scene.render.fps = FPS
END = LOOP + 1  # frame END repeats frame 1

# Head tilt and a slow sway, one full cycle per loop.
for f in range(1, END + 1, 6):
    phase = 2 * math.pi * (f - 1) / LOOP
    neck.rotation_euler = (math.radians(2.5 * math.sin(phase)), math.radians(7 * math.sin(phase)), math.radians(4 * math.sin(phase + 1.0)))
    neck.keyframe_insert("rotation_euler", frame=f)

# Breathing: the body swells a little, twice per loop.
for f in range(1, END + 1, 6):
    phase = 2 * math.pi * 2 * (f - 1) / LOOP
    s = 1.0 + 0.015 * math.sin(phase)
    body.scale = (0.55 * s, 0.48 * s, 0.66 * (2 - s) ** -1)
    body.keyframe_insert("scale", frame=f)

# Blink: both eyes close and open over 6 frames.
for eye in eyes:
    for f, sz in ((1, 1.0), (30, 1.0), (33, 0.08), (36, 1.0), (END, 1.0)):
        eye.scale = (1.0, 1.0, sz)
        eye.keyframe_insert("scale", frame=f)

# Ear twitch: the right ear flicks back and returns.
right_ear = ears[1]
for f, angle in ((1, 0), (46, 0), (49, -14), (52, 6), (55, 0), (END, 0)):
    right_ear.rotation_euler = (math.radians(angle), 0, 0)
    right_ear.keyframe_insert("rotation_euler", frame=f)

# Glow pulse: chest and traces breathe brighter and dimmer, once per loop.
for f in range(1, END + 1, 6):
    phase = 2 * math.pi * (f - 1) / LOOP
    for node, base_strength in ((CHEST_GLOW, 3.0), (TRACE_GLOW, 5.0)):
        node.inputs["Strength"].default_value = base_strength * (1.0 + 0.35 * math.sin(phase))
        node.inputs["Strength"].keyframe_insert("default_value", frame=f)

for action in bpy.data.actions:
    for fcurve in action.fcurves:
        for point in fcurve.keyframe_points:
            point.interpolation = "BEZIER"

# ---------- render ------------------------------------------------------------

scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = SAMPLES
# The distribution build of Blender ships without OpenImageDenoise, so grain is
# held down by samples, clamped bounces and a gentle filter at encode time.
scene.cycles.use_denoising = False
scene.cycles.sample_clamp_indirect = 3.0
scene.cycles.blur_glossy = 1.0
scene.cycles.max_bounces = 6
scene.render.resolution_x = SIZE
scene.render.resolution_y = SIZE
scene.render.film_transparent = False
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast"
scene.render.image_settings.file_format = "PNG"
scene.render.filepath = f"{OUT_DIR}/frame_"

if FRAMES == "all":
    bpy.ops.render.render(animation=True)
else:
    scene.frame_set(int(FRAMES))
    scene.render.filepath = f"{OUT_DIR}/still_{int(FRAMES):04d}.png"
    bpy.ops.render.render(write_still=True)
