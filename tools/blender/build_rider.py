"""
Сборка 3D-райдера для мини-игры из CC0-ассетов Quaternius
(Universal Base Characters + Universal Animation Library, https://quaternius.com).

Из базового тела делается экипировка, привязанная к тому же скелету:
куртка, штаны, перчатки, горнолыжные ботинки, бафф, шлем с маской.
Под одеждой тело удаляется (остаются голова и шея) — нет просвечивания и лишних полигонов.
Из библиотеки анимаций в файл попадают только нужные игре клипы.

Запуск (Blender 4.5):
  blender -b --python tools/blender/build_rider.py -- <variant> <body.gltf> <anims.glb> <out.glb>
  variant: ski | board
"""
import bpy, bmesh, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index('--') + 1:]
VARIANT, BODY, ANIMS, OUT = args[:4]

KEEP_CLIPS = ['Idle_Loop', 'Crouch_Idle_Loop', 'Jump_Loop', 'Death01', 'Hit_Head', 'Roll', 'Swim_Idle_Loop', 'Dance_Loop']

STYLE = {
    'ski':   dict(jacket=(0.85, 0.16, 0.13), stripe=(1.0, 0.8, 0.2), dark=(0.09, 0.09, 0.11),
                  pants=(0.14, 0.14, 0.17), boots=(0.2, 0.36, 0.72), buckle=(0.86, 0.88, 0.92),
                  gloves=(0.06, 0.06, 0.07), helmet=(0.1, 0.1, 0.11), accent=(1.0, 0.8, 0.2),
                  jacket_puff=0.03, pants_puff=0.026, boots_puff=0.038),
    'board': dict(jacket=(0.14, 0.145, 0.17), stripe=(0.36, 1.0, 0.23), dark=(0.05, 0.05, 0.06),
                  pants=(0.24, 0.26, 0.3), boots=(0.12, 0.12, 0.14), buckle=(0.36, 1.0, 0.23),
                  gloves=(0.06, 0.06, 0.07), helmet=(0.95, 0.96, 0.97), accent=(0.36, 1.0, 0.23),
                  jacket_puff=0.04, pants_puff=0.05, boots_puff=0.035),
}[VARIANT]

UPPER = {'spine_01', 'spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r', 'neck_01'}
LEGS = {'pelvis', 'thigh_l', 'thigh_r', 'calf_l', 'calf_r'}
FEET = {'foot_l', 'foot_r', 'ball_l', 'ball_r', 'ball_leaf_l', 'ball_leaf_r'}
HANDS_PREFIX = ('hand_', 'index_', 'middle_', 'pinky_', 'ring_', 'thumb_')


def log(*a):
    print('[rider]', *a, flush=True)


bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=BODY)
for o in list(bpy.data.objects):
    if o.type == 'MESH' and not o.vertex_groups:            # лишняя служебная сфера
        bpy.data.objects.remove(o)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = max((o for o in bpy.data.objects if o.type == 'MESH'), key=lambda o: len(o.data.vertices))
log('body', body.name, len(body.data.vertices))

# --- объём груди у женской модели: плавное «раздувание» от центра, одежда потом повторит форму ---
if VARIANT == 'board':
    BUST = dict(x=0.085, y=-0.045, z=1.305, r=0.125, grow=0.42, lift=-0.008)
    me = body.data
    for v in me.vertices:
        co = body.matrix_world @ v.co
        if co.y > 0.02:
            continue
        for sx in (-1, 1):
            c = Vector((sx * BUST['x'], BUST['y'], BUST['z']))
            d2 = ((co.x - c.x) ** 2 + (co.z - c.z) ** 2 * 1.2) / BUST['r'] ** 2
            if d2 >= 1:
                continue
            f = (1 - d2) ** 2
            off = (co - c) * BUST['grow'] * f
            off.z = off.z * 0.5 + BUST['lift'] * f
            v.co = body.matrix_world.inverted() @ (co + off)
    me.update()

# --- доминирующая кость каждой вершины ---
gname = {g.index: g.name for g in body.vertex_groups}
dom, zpos = [], []
for v in body.data.vertices:
    best = max(v.groups, key=lambda g: g.weight, default=None)
    dom.append(gname[best.group] if best else '')
    zpos.append((body.matrix_world @ v.co).z)


def region(vi):
    d, z = dom[vi], zpos[vi]
    if d.startswith(HANDS_PREFIX):
        return 'gloves'
    if d in FEET or (d in ('calf_l', 'calf_r') and z < 0.34):
        return 'boots'
    if d in UPPER or (d == 'pelvis' and z > 1.0):
        if d == 'neck_01' and z > 1.575:
            return 'skin'
        return 'jacket'
    if d in LEGS:
        return 'pants'
    return 'skin'


REG = [region(i) for i in range(len(body.data.vertices))]
log('regions', {r: REG.count(r) for r in set(REG)})


def lin(c):
    """sRGB → линейный цвет (так хранятся цвета вершин и так их ждёт glTF)."""
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


def color_attr(me, fn):
    """Цвет вершин (COLOR_0 в glTF): fn(co, normal) -> (r,g,b) в sRGB."""
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        ca.data[v.index].color = (*lin(fn(v.co, v.normal)), 1.0)
    return ca


def make_mat(name, rough=0.8, metal=0.0, vcol=True, color=(1, 1, 1), emissive=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.use_backface_culling = False
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if vcol:
        n = nt.nodes.new('ShaderNodeVertexColor'); n.layer_name = 'Col'
        nt.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*lin(color), 1)
    if emissive:
        bsdf.inputs['Emission Color'].default_value = (*emissive, 1)
        bsdf.inputs['Emission Strength'].default_value = 1.0
    return m


def hem_loops(bm):
    """Связные группы граничных вершин (каждая — один край одежды)."""
    left = {v for v in bm.verts if v.is_boundary}
    loops = []
    while left:
        start = left.pop(); grp = [start]; stack = [start]
        while stack:
            v = stack.pop()
            for e in v.link_edges:
                if not e.is_boundary:
                    continue
                o = e.other_vert(v)
                if o in left:
                    left.remove(o); grp.append(o); stack.append(o)
        if len(grp) > 6:
            loops.append(grp)
    return loops


def piece(name, regs, puff, colorfn, rough, smooth=5):
    """Копия тела только с нужной зоной, «надутая» по нормалям; веса костей сохраняются."""
    o = body.copy(); o.data = body.data.copy(); o.name = name; o.data.name = name
    bpy.context.collection.objects.link(o)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.verts.ensure_lookup_table()
    keep = {i for i, r in enumerate(REG) if r in regs}
    # грань берём, если хоть одна вершина в зоне: соседние куски одежды перекрываются, щелей нет
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if not any(v.index in keep for v in f.verts)], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * puff
    # сглаживание складок, чтобы одежда была мягкой, а не повторяла мышцы
    inner = [v for v in bm.verts if not v.is_boundary]
    for _ in range(smooth):
        bmesh.ops.smooth_vert(bm, verts=inner, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    # край одежды: сглаживаем только вдоль самой границы — зубцы превращаются в плавный подгиб
    edge = [v for v in bm.verts if v.is_boundary]
    for _ in range(8):
        new = {}
        for v in edge:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2:
                new[v] = v.co * 0.4 + (nb[0].co + nb[1].co) * 0.3
        for v, c in new.items():
            v.co = c
    bm.to_mesh(o.data); bm.free()
    o.data.materials.clear()
    o.data.materials.append(make_mat('M_' + name, rough=rough))
    for p in o.data.polygons:
        p.material_index = 0
    color_attr(o.data, colorfn)
    return o


S = STYLE
def shade(c, k):
    return tuple(min(1.0, v * k) for v in c)


def jacket_col(co, n):
    x, y, z = co.x, co.y, co.z
    if abs(x) < 0.012 and y < 0 and z < 1.5:                      # молния
        return S['dark']
    if abs(x) > 0.64:                                              # манжеты
        return S['stripe']
    if z < 1.035:                                                  # низ куртки
        return S['stripe']
    return S['jacket']


def pants_col(co, n):
    x, z = abs(co.x), co.z
    if 0.52 < z < 0.6 and co.y < 0:                                 # вставки на коленях
        return shade(S['pants'], 0.7)
    if 0.66 < z < 0.8 and x > 0.15 and abs(co.y) < 0.05:            # боковые карманы-карго
        return shade(S['pants'], 0.62) if (0.66 < z < 0.672 or 0.788 < z) else shade(S['pants'], 0.85)
    if 0.96 < z < 1.0:                                              # пояс
        return shade(S['pants'], 0.6)
    return S['pants']


def boots_col(co, n):
    z = co.z
    if z < 0.03:
        return (0.05, 0.05, 0.06)                                   # подошва
    if z > 0.27:
        return shade(S['boots'], 0.55)                              # мягкий верх-манжета
    return S['boots']


jacket = piece('Jacket', {'jacket'}, S['jacket_puff'] + 0.014, jacket_col, 0.55, smooth=16)
pants = piece('Pants', {'pants'}, S['pants_puff'] + 0.014, pants_col, 0.75, smooth=12)
boots = piece('Boots', {'boots'}, S['boots_puff'], boots_col, 0.35 if VARIANT == 'ski' else 0.6)
gloves = piece('Gloves', {'gloves'}, 0.012, lambda co, n: S['gloves'], 0.6)

# --- тело под одеждой убираем: остаются голова и шея ---
bm = bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if not any(REG[v.index] == 'skin' for v in f.verts)], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
bm.to_mesh(body.data); bm.free()
log('skin verts left', len(body.data.vertices))

# --- шлем, маска и бафф: жёстко на кости головы / шеи ---
def rigid(obj, bone):
    for p in obj.data.polygons:
        p.use_smooth = True
    obj.vertex_groups.clear()
    g = obj.vertex_groups.new(name=bone)
    g.add(list(range(len(obj.data.vertices))), 1.0, 'REPLACE')
    for b in arm.data.bones:
        if b.name != bone:
            obj.vertex_groups.new(name=b.name)
    mod = obj.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
    obj.parent = arm


def head_frame():
    hb = arm.data.bones['Head']
    return arm.matrix_world @ hb.head_local


hc = head_frame()
# шлем: оболочка над головой; спереди край над бровями, по бокам закрывает уши, сзади — затылок
HR = 0.128
bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=28, radius=HR, location=(hc.x, hc.y + 0.018, hc.z + 0.128))
helmet = bpy.context.object; helmet.name = 'Helmet'
helmet.scale = (1.0, 1.13, 0.98)
bpy.ops.object.transform_apply(scale=True)
bm = bmesh.new(); bm.from_mesh(helmet.data)
def keep_helmet(co):
    front = co.y < hc.y - 0.03
    side = abs(co.x - hc.x) > 0.085
    lim = hc.z + (0.138 if front and not side else 0.062 if side else 0.05)
    return co.z >= lim
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not keep_helmet(v.co)], context='VERTS')
bm.to_mesh(helmet.data); bm.free()
sol = helmet.modifiers.new('Solid', 'SOLIDIFY'); sol.thickness = 0.013; sol.offset = 1
bpy.ops.object.modifier_apply(modifier='Solid')
bev = helmet.modifiers.new('Smooth', 'SUBSURF'); bev.levels = 1
bpy.ops.object.modifier_apply(modifier='Smooth')
helmet.data.materials.append(make_mat('M_Helmet', rough=0.42))
def helmet_col(co, n):
    return S['helmet']
color_attr(helmet.data, helmet_col)
rigid(helmet, 'Head')

# маска: широкая изогнутая зеркальная линза на уровне глаз + ремешок поверх шлема
gz = hc.z + 0.097
bpy.ops.mesh.primitive_cylinder_add(vertices=56, radius=HR + 0.017, depth=0.03, location=(hc.x, hc.y + 0.018, gz))
strap = bpy.context.object; strap.name = 'Goggles'
strap.scale = (1.0, 1.13, 1.0); bpy.ops.object.transform_apply(scale=True)
bm = bmesh.new(); bm.from_mesh(strap.data)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if len(f.verts) > 4], context='FACES')
bm.to_mesh(strap.data); bm.free()
strap.data.materials.append(make_mat('M_Strap', rough=0.7))
color_attr(strap.data, lambda co, n: S['accent'] if abs(co.x - hc.x) > 0.105 and co.y > hc.y - 0.02 else (0.04, 0.04, 0.05))
# оправа и линза — передняя дуга цилиндра
for rad, dep, name, mat, colfn in (
    (HR + 0.021, 0.07, 'Frame', make_mat('M_Frame', rough=0.5), lambda co, n: (0.05, 0.05, 0.06)),
    (HR + 0.027, 0.058, 'Lens', make_mat('M_Lens', rough=0.06, metal=0.85), None),
):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=rad, depth=dep, location=(hc.x, hc.y + 0.018, gz))
    o = bpy.context.object
    o.scale = (1.0, 1.13, 1.0); bpy.ops.object.transform_apply(scale=True)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if len(f.verts) > 4 or f.calc_center_median().y > hc.y - 0.02], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(o.data); bm.free()
    o.data.materials.append(mat)
    if colfn is None:
        def colfn(co, n):
            t = max(0.0, min(1.0, (co.x - hc.x + 0.12) / 0.24))
            a, b, c = (1.0, 0.62, 0.2), (1.0, 0.3, 0.5), (0.35, 0.45, 1.0)
            return tuple(a[i] + (b[i] - a[i]) * t * 2 if t < 0.5 else b[i] + (c[i] - b[i]) * (t - 0.5) * 2 for i in range(3))
    color_attr(o.data, colfn)
    for x in bpy.data.objects:
        x.select_set(False)
    o.select_set(True); strap.select_set(True); bpy.context.view_layer.objects.active = strap
    bpy.ops.object.join()
rigid(strap, 'Head')

# бафф на шее — закрывает шею и подбородок, как у настоящих райдеров
nk = arm.matrix_world @ arm.data.bones['neck_01'].head_local
bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=0.075, depth=0.13, location=(nk.x, nk.y - 0.006, nk.z + 0.07))
buff = bpy.context.object; buff.name = 'Buff'
buff.scale = (1.05, 1.0, 1.0); bpy.ops.object.transform_apply(scale=True)
buff.data.materials.append(make_mat('M_Buff', rough=0.9))
color_attr(buff.data, lambda co, n: S['dark'])
rigid(buff, 'neck_01')

for o in (jacket, pants, boots, gloves, helmet, strap, buff):
    o.parent = arm

# волосы под шлемом не нужны
for o in list(bpy.data.objects):
    if o.type == 'MESH' and o.name.lower().startswith('hair'):
        bpy.data.objects.remove(o)

# --- анимации из библиотеки ---
before = set(bpy.data.actions)
bpy.ops.import_scene.gltf(filepath=ANIMS)
new_objs = [o for o in bpy.context.scene.objects if o not in (arm,) and o.name not in {x.name for x in (body, jacket, pants, boots, gloves, helmet, strap, buff)} and (o.type == 'ARMATURE' or (o.parent and o.parent.type == 'ARMATURE' and o.parent != arm))]
for a in bpy.data.actions:
    if a in before:
        continue
    base = a.name.split('|')[-1] if '|' in a.name else a.name
    if base in KEEP_CLIPS:
        a.name = base
        a.use_fake_user = True
    else:
        bpy.data.actions.remove(a)
for o in new_objs:
    bpy.data.objects.remove(o)
for a in list(bpy.data.actions):                 # клипы исходной модели (если были) — прочь
    if a.name not in KEEP_CLIPS:
        bpy.data.actions.remove(a)
log('clips', sorted(a.name for a in bpy.data.actions))
# каждое действие — дорожкой NLA, чтобы экспортёр взял все
arm.animation_data_create()
arm.animation_data.action = None
for a in bpy.data.actions:
    tr = arm.animation_data.nla_tracks.new(); tr.name = a.name
    st = tr.strips.new(a.name, 1, a); st.name = a.name
    tr.mute = True

# --- текстуры головы: меньше и в JPEG ---
for img in bpy.data.images:
    if img.size[0] > 1024:
        img.scale(1024, 1024)

bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=False,
    export_animations=True, export_animation_mode='NLA_TRACKS', export_nla_strips=True,
    export_force_sampling=True, export_optimize_animation_size=True,
    export_image_format='JPEG', export_jpeg_quality=82,
    export_vertex_color='MATERIAL', export_all_vertex_colors=False,
    export_skins=True, export_morph=False, export_apply=False,
)
log('saved', OUT)
