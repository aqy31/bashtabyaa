import bpy
import json
import os
from mathutils import Vector

SRC_BLEND = "/Users/abdulrhman/.gemini/antigravity/scratch/bashtapia_castle_textured/bashtapia_cinematic.blend"
OUT_DIR   = "/Users/abdulrhman/.gemini/antigravity/scratch/bashtapia-virtual-tour/public/assets"
OUT_GLB   = os.path.join(OUT_DIR, "bashtapia_castle.glb")
OUT_META  = os.path.join(OUT_DIR, "scene_metadata.json")


def b2g(v):
    """Convert Blender Z-up (x, y, z) to glTF/Three.js Y-up (x, z, -y)."""
    return [round(float(v[0]), 4), round(float(v[2]), 4), round(float(-v[1]), 4)]


def reconnect_pbr_textures_for_gltf(mat_name):
    """
    Ensure Blender's glTF exporter sees direct Image Texture -> Principled BSDF links
    for Base Color, Roughness, and Normal, while preserving full-resolution textures.
    Our Three.js shaders will re-apply the exact rainy wetness, puddles, and ripples on top.
    """
    mat = bpy.data.materials.get(mat_name)
    if not mat or not mat.use_nodes:
        return
    nt = mat.node_tree
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        return

    tex_nodes = [n for n in nt.nodes if n.type == 'TEX_IMAGE' and n.image]
    albedo_node = None
    rough_node = None
    normal_node = None
    for n in tex_nodes:
        iname = n.image.name.lower()
        if "albedo" in iname or "color" in iname or "diff" in iname:
            albedo_node = n
        elif "rough" in iname:
            rough_node = n
        elif "norm" in iname:
            normal_node = n

    # Reconnect Base Color directly to albedo texture
    if albedo_node:
        for l in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(l)
        nt.links.new(albedo_node.outputs["Color"], bsdf.inputs["Base Color"])

    # Reconnect Roughness directly to roughness texture
    if rough_node:
        for l in list(bsdf.inputs["Roughness"].links):
            nt.links.remove(l)
        nt.links.new(rough_node.outputs["Color"], bsdf.inputs["Roughness"])

    # Reconnect Normal directly through NormalMap node
    if normal_node:
        for l in list(bsdf.inputs["Normal"].links):
            nt.links.remove(l)
        nrm_map = next((n for n in nt.nodes if n.type == 'NORMAL_MAP'), None)
        if not nrm_map:
            nrm_map = nt.nodes.new("ShaderNodeNormalMap")
        for l in list(nrm_map.inputs["Color"].links):
            nt.links.remove(l)
        nt.links.new(normal_node.outputs["Color"], nrm_map.inputs["Color"])
        nt.links.new(nrm_map.outputs["Normal"], bsdf.inputs["Normal"])


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=SRC_BLEND)

    # 1. Extract exact metadata from the original cinematic scene
    meta = {
        "braziers": [],
        "torches": [],
        "sun": None,
        "bounds": {},
    }

    # Gather braziers & torches with exact flame, ember, and light positions
    brazier_bases = [o for o in bpy.data.objects if o.name.startswith("Brazier_") and not any(
        o.name.endswith(s) for s in ("_Flame", "_Light", "_Logs", "_Sparks")
    )]
    for b in sorted(brazier_bases, key=lambda o: o.name):
        fl = bpy.data.objects.get(f"{b.name}_Flame")
        lt = bpy.data.objects.get(f"{b.name}_Light")
        power = float(lt.data.energy) if (lt and lt.type == 'LIGHT') else 180.0
        meta["braziers"].append({
            "name": b.name,
            "base": b2g(b.matrix_world.translation),
            "flame": b2g(fl.matrix_world.translation) if fl else b2g(b.matrix_world.translation + Vector((0, 0, 1.0))),
            "light": b2g(lt.matrix_world.translation) if lt else b2g(b.matrix_world.translation + Vector((0, 0, 1.48))),
            "power": round(power, 1),
            "isInner": "Inner_" in b.name,
        })

    torch_irons = [o for o in bpy.data.objects if o.name.startswith("Stair_Torch_") and o.name.endswith("_Iron")]
    for t in sorted(torch_irons, key=lambda o: o.name):
        prefix = t.name[:-5]
        fl = bpy.data.objects.get(f"{prefix}_Flame")
        lt = bpy.data.objects.get(f"{prefix}_Light")
        power = float(lt.data.energy) if (lt and lt.type == 'LIGHT') else 145.0
        meta["torches"].append({
            "name": prefix,
            "base": b2g(t.matrix_world.translation),
            "flame": b2g(fl.matrix_world.translation) if fl else b2g(t.matrix_world.translation),
            "light": b2g(lt.matrix_world.translation) if lt else b2g(t.matrix_world.translation),
            "power": round(power, 1),
        })

    sun_obj = bpy.data.objects.get("Sun_Light")
    if sun_obj and sun_obj.type == 'LIGHT':
        sun_dir_b = sun_obj.matrix_world.to_quaternion() @ Vector((0, 0, -1))
        meta["sun"] = {
            "direction": b2g(sun_dir_b),
            "energy": round(float(sun_obj.data.energy), 3),
            "color": [round(float(c), 3) for c in sun_obj.data.color],
        }

    with open(OUT_META, "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)
    print(f"Wrote scene metadata: {OUT_META} ({len(meta['braziers'])} braziers, {len(meta['torches'])} torches)")

    # 2. Prepare materials for clean glTF PBR texture export
    for mname in [
        "Mat_BashTapia_WallStone",
        "Mat_BashTapia_DressedStone",
        "Mat_BashTapia_FloorStone",
        "Mat_BashTapia_Terrain",
    ]:
        reconnect_pbr_textures_for_gltf(mname)

    # Simplify Mat_Tigris_River & Mat_Glowing_Embers & Mat_Realistic_Fire to clean Principled placeholders
    # (Three.js replaces them with exact animated GLSL shaders!)
    for mname, col_rgba, rough in [
        ("Mat_Tigris_River", (0.045, 0.082, 0.088, 1.0), 0.09),
        ("Mat_Glowing_Embers", (0.08, 0.03, 0.01, 1.0), 0.85),
        ("Mat_Realistic_Fire", (1.0, 0.35, 0.02, 1.0), 0.5),
    ]:
        m = bpy.data.materials.get(mname)
        if m and m.use_nodes:
            nt = m.node_tree
            nt.nodes.clear()
            out = nt.nodes.new("ShaderNodeOutputMaterial")
            bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
            bsdf.inputs["Base Color"].default_value = col_rgba
            bsdf.inputs["Roughness"].default_value = rough
            nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    # 3. Remove Displace modifiers from flame meshes so they export in exact clean rest-pose
    # (Our GPU vertex shader in Three.js animates them with identical upward-flowing 3D wind turbulence!)
    for o in bpy.data.objects:
        if o.name.endswith("_Flame") and o.type == 'MESH':
            for mod in list(o.modifiers):
                o.modifiers.remove(mod)

    # 4. Select ONLY what we want in the GLB (100% of castle, terrain, river, nests, grass, trees, braziers, torches, flames, 1 bird template)
    # Exclude volumetric mist box, camera-locked rain meshes (rebuilt on GPU), sparks (rebuilt on GPU), drivers, cameras, lights, extra birds.
    exclude_exact = {
        "Atmospheric_Rain_Mist",
        "Rain_World_Anchor",
        "Rain_Layer_1",
        "Rain_Layer_2",
        "Rain_Layer_3",
        "Fire_Wind_Driver_X",
        "Fire_Wind_Driver_Y",
        "Cinema_Camera",
        "Cinema_Target",
    }

    bpy.ops.object.select_all(action='DESELECT')
    exported_count = 0
    exported_verts = 0
    exported_polys = 0
    kept_bird = False

    for o in bpy.data.objects:
        if o.name in exclude_exact:
            continue
        if o.type in ('CAMERA', 'LIGHT', 'EMPTY'):
            continue
        if o.name.endswith("_Sparks"):
            continue
        if o.name.startswith("Mosul_Bird_"):
            if not kept_bird:
                # Reset first bird to origin as a clean template mesh for Three.js instancing/cloning
                o.animation_data_clear()
                o.location = (0, 0, 0)
                o.rotation_euler = (0, 0, 0)
                o.scale = (1, 1, 1)
                o.name = "Mosul_Bird_Template"
                kept_bird = True
            else:
                continue

        if o.type == 'MESH':
            o.select_set(True)
            exported_count += 1
            exported_verts += len(o.data.vertices)
            exported_polys += len(o.data.polygons)

    print(f"Exporting {exported_count} meshes ({exported_verts} verts, {exported_polys} polys) at 100% FULL DETAIL...")

    bpy.ops.export_scene.gltf(
        filepath=OUT_GLB,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials='EXPORT',
        export_image_format='WEBP',
        export_image_quality=88,
        export_animations=False,
        export_lights=False,
        export_cameras=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        export_yup=True,
    )
    size_mb = os.path.getsize(OUT_GLB) / (1024 * 1024)
    print(f"SUCCESS: Exported {OUT_GLB} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
