# tools/blender/run_bake.py — M5 一键烘焙: assemble -> uv2 -> 4图烘焙 -> night 美图
# 用法:
#   blender -b -P tools/blender/main.py -- run_bake                    # 全组 512/8spp
#   blender -b -P tools/blender/main.py -- run_bake --only shell       # 只烘墙地顶组
#   ... [--force] [--size 512] [--samples 8] [--beauty-samples 32] [--skip-beauty]
import bpy
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import assemble
import bake_uv2
import bake_cycles
import lights

BEAUTY_CAM_LOC = (-1.7, -1.6, 1.7)     # room_shell 同款左前对角线机位
BEAUTY_CAM_TGT = (0.55, 0.75, 1.05)
BEAUTY_LENS = 28


def _args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    a = argv[1:] if argv else []

    def opt(name, default):
        if name in a and a.index(name) + 1 < len(a):
            return type(default)(a[a.index(name) + 1])
        return default

    only = None
    if "--only" in a and a.index("--only") + 1 < len(a):
        only = [g for g in a[a.index("--only") + 1].split(",") if g]
    return {
        "only": only,
        "force": "--force" in a,
        "size": opt("--size", 512),
        "samples": opt("--samples", 8),
        "beauty_samples": opt("--beauty-samples", 32),
        "skip_beauty": "--skip-beauty" in a,
    }


def render_beauty(env, out_path, samples):
    sc = bpy.context.scene
    lights.setup("night")
    desk = bpy.data.objects.get("prop_desk_top")
    if desk:
        print("[beauty] canary desk mats:",
              [m.name if m else None for m in desk.data.materials])
    cam = env['add_camera'](BEAUTY_CAM_LOC, BEAUTY_CAM_TGT, lens=BEAUTY_LENS)
    sc.render.engine = 'CYCLES'
    sc.cycles.samples = samples
    sc.cycles.use_denoising = True
    sc.render.resolution_x = 960
    sc.render.resolution_y = 540
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'
    sc.render.filepath = out_path
    prev = sc.view_settings.view_transform
    sc.view_settings.view_transform = 'AgX'      # 夜景美图用 AgX
    t0 = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    dt = time.perf_counter() - t0
    sc.view_settings.view_transform = prev
    bpy.data.objects.remove(cam, do_unlink=True)
    print(f"[beauty] {out_path} {dt:.1f}s (960x540 {samples}spp denoise)")
    return dt


def build(env):
    t_start = time.perf_counter()
    a = _args()
    print(f"[run_bake] args: {a}")

    bake_cycles.pick_device()      # 装配前探测 GPU (OPTIX->CUDA->CPU), 利用空场景
    ctx = assemble.build(env)
    bake_uv2.build_uv2(ctx, tex_size=a["size"])
    bake_cycles.bake_groups(ctx, groups=a["only"], size=a["size"],
                            samples=a["samples"], force=a["force"])

    beauty_dt = None
    if not a["skip_beauty"]:
        out = os.path.join(env['OUT'], "bake_beauty.png")
        beauty_dt = render_beauty(env, out, a["beauty_samples"])

    total = time.perf_counter() - t_start
    outdir = os.path.join(assemble.V1, bake_uv2.ATLAS_DIRNAME)
    print("=" * 60)
    print(f"[run_bake] TOTAL {total:.1f}s  (beauty {beauty_dt or 0:.1f}s)")
    print("[run_bake] products:")
    for f in sorted(os.listdir(outdir)):
        p = os.path.join(outdir, f)
        print(f"  {p} ({os.path.getsize(p) / 1024:.0f} KB)")
    bpath = os.path.join(env['OUT'], "bake_beauty.png")
    if os.path.exists(bpath):
        print(f"  {bpath} ({os.path.getsize(bpath) / 1024:.0f} KB)")
    print("=" * 60)
    return ctx
