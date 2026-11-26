import * as THREE from 'three';

/**
 * Shared shader uniforms updated every frame so puddles, Tigris River,
 * glowing embers, and wet grass animate smoothly in sync with the rain.
 */
export const sharedShaderUniforms = {
  uTime: { value: 0 },
  uPuddleEnabled: { value: 1.0 },
  uRiverEnabled: { value: 1.0 },
  uRainIntensity: { value: 1.0 },
};

const GLSL_NOISE_HELPERS = /* glsl */ `
  float btHash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float btNoise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = btHash21(i);
    float b = btHash21(i + vec2(1.0, 0.0));
    float c = btHash21(i + vec2(0.0, 1.0));
    float d = btHash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  float btFbm2D(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 4; i++) {
      v += a * btNoise2D(p);
      p = rot * p * 2.03 + vec2(17.1, 31.7);
      a *= 0.5;
    }
    return v;
  }

  // Expanding concentric raindrop ripples in a tiled cell grid
  vec2 btRainRippleNormal(vec2 uv, float t) {
    vec2 cell = floor(uv);
    vec2 local = fract(uv) - 0.5;
    vec2 grad = vec2(0.0);
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 nb = cell + vec2(float(x), float(y));
        float h = btHash21(nb);
        float phase = fract(t * (0.75 + 0.5 * h) + h * 11.3);
        vec2 center = vec2(btHash21(nb + 3.1), btHash21(nb + 7.7)) - 0.5;
        vec2 d = local - (vec2(float(x), float(y)) + center * 0.65);
        float dist = length(d);
        float radius = phase * 0.62;
        float ring = exp(-pow((dist - radius) * 14.0, 2.0)) * sin((dist - radius) * 34.0);
        float fade = (1.0 - phase) * (1.0 - phase) * smoothstep(0.0, 0.08, phase);
        grad += normalize(d + 1e-4) * ring * fade;
      }
    }
    return grad;
  }
`;

function upgradeToPhysical(oldMat, extraProps = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    name: oldMat.name,
    color: oldMat.color ? oldMat.color.clone() : new THREE.Color(1, 1, 1),
    map: oldMat.map || null,
    normalMap: oldMat.normalMap || null,
    normalScale: oldMat.normalScale ? oldMat.normalScale.clone() : new THREE.Vector2(1, 1),
    roughnessMap: oldMat.roughnessMap || null,
    metalnessMap: oldMat.metalnessMap || null,
    roughness: oldMat.roughness !== undefined ? oldMat.roughness : 0.75,
    metalness: oldMat.metalness !== undefined ? oldMat.metalness : 0.0,
    side: oldMat.side,
    ...extraProps,
  });
  return mat;
}

/**
 * Upgrade all materials in the loaded Bash Tapia GLB to match the exact
 * rainy-wet stone, animated shimmering puddles, animated Tigris River,
 * glowing embers, and wind-swaying wet grass from bashtapia_cinematic.blend.
 */
export function upgradeCastleMaterials(root) {
  const matCache = new Map();
  const flameMeshes = [];

  root.traverse((obj) => {
    if (!obj.isMesh) return;

    if (obj.name.endsWith('_Flame')) {
      flameMeshes.push(obj);
      obj.castShadow = false;
      obj.receiveShadow = false;
      return;
    }

    // Enable shadows smartly (terrain & large castle receive, castle casts)
    if (obj.name === 'Tigris_River_Plane' || obj.name === 'Tigris_FarBank_Trees') {
      obj.castShadow = false;
      obj.receiveShadow = true;
    } else if (obj.name === 'Mosul_Wet_Grass_Tufts') {
      obj.castShadow = false;
      obj.receiveShadow = true;
    } else {
      obj.castShadow = true;
      obj.receiveShadow = true;
    }

    const processMat = (m) => {
      if (!m) return m;
      if (matCache.has(m.name)) return matCache.get(m.name);

      let upgraded = m;

      // 1. Wet Rain-Slicked Masonry Walls & Dressed Stone
      if (m.name === 'Mat_BashTapia_WallStone' || m.name === 'Mat_BashTapia_DressedStone') {
        const isDressed = m.name === 'Mat_BashTapia_DressedStone';
        upgraded = upgradeToPhysical(m, {
          clearcoat: isDressed ? 0.42 : 0.45,
          clearcoatRoughness: 0.16,
          envMapIntensity: 0.9,
        });
        const darkMult = isDressed ? 0.80 : 0.76;
        const wetRoughMin = isDressed ? 0.28 : 0.26;
        upgraded.onBeforeCompile = (shader) => {
          shader.uniforms.uDarkMult = { value: darkMult };
          shader.uniforms.uWetRoughMin = { value: wetRoughMin };
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBtWorldPos;')
            .replace(
              '#include <worldpos_vertex>',
              '#include <worldpos_vertex>\nvBtWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>\nuniform float uDarkMult;\nuniform float uWetRoughMin;\nvarying vec3 vBtWorldPos;\n${GLSL_NOISE_HELPERS}`
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
               // Vertical rain-runoff wetness streaks darkening stone
               float streak = btFbm2D(vec2(vBtWorldPos.x * 0.45 + vBtWorldPos.z * 0.45, vBtWorldPos.y * 0.11));
               float wetDark = mix(uDarkMult * 0.86, uDarkMult * 1.04, smoothstep(0.35, 0.72, streak));
               diffuseColor.rgb *= wetDark;`
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
               float rStreak = btFbm2D(vec2(vBtWorldPos.x * 0.45 + vBtWorldPos.z * 0.45, vBtWorldPos.y * 0.11));
               float wetFactor = mix(uWetRoughMin, 0.78, smoothstep(0.35, 0.72, rStreak));
               roughnessFactor = clamp(roughnessFactor * wetFactor, 0.18, 0.88);`
            );
        };
      }

      // 2. Animated Shimmering Rainwater Puddles on Courtyard & Bastion Floors!
      else if (m.name === 'Mat_BashTapia_FloorStone') {
        upgraded = upgradeToPhysical(m, {
          clearcoat: 0.72,
          clearcoatRoughness: 0.06,
          envMapIntensity: 1.35,
          roughness: 0.42,
        });
        upgraded.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = sharedShaderUniforms.uTime;
          shader.uniforms.uPuddleEnabled = sharedShaderUniforms.uPuddleEnabled;
          shader.uniforms.uRainIntensity = sharedShaderUniforms.uRainIntensity;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBtWorldPos;\nvarying vec3 vBtWorldNorm;')
            .replace(
              '#include <worldpos_vertex>',
              `#include <worldpos_vertex>
               vBtWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
               vBtWorldNorm = normalize(mat3(modelMatrix) * objectNormal);`
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
               uniform float uTime;
               uniform float uPuddleEnabled;
               uniform float uRainIntensity;
               varying vec3 vBtWorldPos;
               varying vec3 vBtWorldNorm;
               ${GLSL_NOISE_HELPERS}
               float btPuddleMask(vec3 wp, vec3 wn) {
                 float upMask = smoothstep(0.65, 0.92, wn.y);
                 float n = btFbm2D(wp.xz * 0.17 + vec2(3.4, -1.8));
                 return upMask * smoothstep(0.43, 0.56, n) * uPuddleEnabled;
               }`
            )
            .replace(
              '#include <color_fragment>',
              `#include <color_fragment>
               float pMaskCol = btPuddleMask(vBtWorldPos, vBtWorldNorm);
               vec3 dryCol = diffuseColor.rgb * 0.72;
               vec3 wetCol = diffuseColor.rgb * 0.40;
               diffuseColor.rgb = mix(dryCol, wetCol, pMaskCol);`
            )
            .replace(
              '#include <roughnessmap_fragment>',
              `#include <roughnessmap_fragment>
               float pMaskRough = btPuddleMask(vBtWorldPos, vBtWorldNorm);
               roughnessFactor = mix(0.42, 0.03, pMaskRough);`
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
               float pMaskN = btPuddleMask(vBtWorldPos, vBtWorldNorm);
               vec3 btViewPuddleN = normal;
               if (pMaskN > 0.01) {
                 vec2 rip1 = btRainRippleNormal(vBtWorldPos.xz * 0.85, uTime * 1.15);
                 vec2 rip2 = btRainRippleNormal(vBtWorldPos.xz * 1.55 + vec2(11.3, 5.7), uTime * 1.45);
                 float micro = sin(vBtWorldPos.x * 9.0 + uTime * 4.0) * cos(vBtWorldPos.z * 9.0 - uTime * 3.5) * 0.025;
                 vec2 totalRip = (rip1 * 0.18 + rip2 * 0.11 + vec2(micro)) * clamp(uRainIntensity, 0.25, 1.5);
                 vec3 puddleN = normalize(vec3(totalRip.x, 1.0, totalRip.y));
                 btViewPuddleN = normalize((viewMatrix * vec4(puddleN, 0.0)).xyz);
                 normal = normalize(mix(normal, btViewPuddleN, pMaskN * 0.92));
               }`
            )
            .replace(
              '#include <clearcoat_normal_fragment_maps>',
              `#include <clearcoat_normal_fragment_maps>
               if (pMaskN > 0.01) {
                 clearcoatNormal = normalize(mix(clearcoatNormal, btViewPuddleN, pMaskN * 0.95));
               }`
            );
        };
      }

      // 3. Rain-Darkened Terrain
      else if (m.name === 'Mat_BashTapia_Terrain') {
        upgraded = upgradeToPhysical(m, {
          roughness: 0.86,
          clearcoat: 0.08,
          clearcoatRoughness: 0.45,
        });
        upgraded.color.multiplyScalar(0.72);
      }

      // 4. Animated Rain-Dappled Tigris River
      else if (m.name === 'Mat_Tigris_River') {
        upgraded = new THREE.MeshPhysicalMaterial({
          name: m.name,
          color: new THREE.Color(0.045, 0.085, 0.095),
          roughness: 0.08,
          metalness: 0.08,
          clearcoat: 0.92,
          clearcoatRoughness: 0.05,
          envMapIntensity: 1.45,
        });
        upgraded.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = sharedShaderUniforms.uTime;
          shader.uniforms.uRiverEnabled = sharedShaderUniforms.uRiverEnabled;
          shader.uniforms.uRainIntensity = sharedShaderUniforms.uRainIntensity;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBtWorldPos;')
            .replace(
              '#include <worldpos_vertex>',
              '#include <worldpos_vertex>\nvBtWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;'
            );
          shader.fragmentShader = shader.fragmentShader
            .replace(
              '#include <common>',
              `#include <common>
               uniform float uTime;
               uniform float uRiverEnabled;
               uniform float uRainIntensity;
               varying vec3 vBtWorldPos;
               ${GLSL_NOISE_HELPERS}`
            )
            .replace(
              '#include <normal_fragment_maps>',
              `#include <normal_fragment_maps>
               vec3 btRiverViewN = normal;
               if (uRiverEnabled > 0.5) {
                 float t = uTime;
                 // Gentle river current flowing along X + raindrop splash ripples
                 vec2 flowUV = vBtWorldPos.xz * 0.14 + vec2(t * 0.18, t * 0.04);
                 float h0 = btFbm2D(flowUV);
                 float hx = btFbm2D(flowUV + vec2(0.08, 0.0));
                 float hz = btFbm2D(flowUV + vec2(0.0, 0.08));
                 vec2 swellGrad = vec2(hx - h0, hz - h0) * 1.9;
                 vec2 rainRip = btRainRippleNormal(vBtWorldPos.xz * 0.55, t * 1.35) * 0.14 * clamp(uRainIntensity, 0.25, 1.5);
                 vec3 wNorm = normalize(vec3(swellGrad.x + rainRip.x, 1.0, swellGrad.y + rainRip.y));
                 btRiverViewN = normalize((viewMatrix * vec4(wNorm, 0.0)).xyz);
                 normal = btRiverViewN;
               }`
            )
            .replace(
              '#include <clearcoat_normal_fragment_maps>',
              `#include <clearcoat_normal_fragment_maps>
               if (uRiverEnabled > 0.5) {
                 clearcoatNormal = btRiverViewN;
               }`
            );
        };
      }

      // 5. Glowing Pulsing Coals & Charred Logs inside Braziers & Torches
      else if (m.name === 'Mat_Glowing_Embers') {
        upgraded = new THREE.MeshStandardMaterial({
          name: m.name,
          color: new THREE.Color(0.05, 0.025, 0.015),
          roughness: 0.85,
          metalness: 0.05,
          emissive: new THREE.Color(1.0, 0.28, 0.03),
          emissiveIntensity: 3.2,
        });
        upgraded.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = sharedShaderUniforms.uTime;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec3 vBtLocalPos;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBtLocalPos = position;');
          shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>\nuniform float uTime;\nvarying vec3 vBtLocalPos;\n${GLSL_NOISE_HELPERS}`)
            .replace(
              '#include <emissivemap_fragment>',
              `#include <emissivemap_fragment>
               float eNoise = btFbm2D(vBtLocalPos.xz * 9.0 + vec2(vBtLocalPos.y * 5.0, uTime * 0.65));
               float pulse = 0.78 + 0.22 * sin(uTime * 3.8 + vBtLocalPos.x * 12.0);
               float hot = smoothstep(0.34, 0.82, eNoise) * pulse;
               vec3 coalCol = mix(vec3(0.45, 0.02, 0.002), vec3(1.0, 0.52, 0.08), hot);
               totalEmissiveRadiance = coalCol * (hot * 5.5 + 0.25);`
            );
        };
      }

      // 6. Wet Wind-Swaying Mosul Grass
      else if (m.name === 'Mat_Mosul_WetGrass') {
        upgraded = upgradeToPhysical(m, {
          color: new THREE.Color(0.11, 0.17, 0.055),
          roughness: 0.34,
          clearcoat: 0.45,
          clearcoatRoughness: 0.12,
          side: THREE.DoubleSide,
        });
        upgraded.onBeforeCompile = (shader) => {
          shader.uniforms.uTime = sharedShaderUniforms.uTime;
          shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nuniform float uTime;')
            .replace(
              '#include <begin_vertex>',
              `#include <begin_vertex>
               float sway = sin(uTime * 2.4 + position.x * 0.9 + position.z * 0.7) * 0.035;
               transformed.x += sway;
               transformed.z += sway * 0.5;`
            );
        };
      }

      // 7. Wrought Iron Braziers & Sconces
      else if (m.name === 'Mat_Torch_Iron') {
        upgraded = upgradeToPhysical(m, {
          color: new THREE.Color(0.05, 0.05, 0.058),
          roughness: 0.42,
          metalness: 0.88,
          clearcoat: 0.35,
          clearcoatRoughness: 0.16,
        });
      }

      matCache.set(m.name, upgraded);
      return upgraded;
    };

    if (Array.isArray(obj.material)) {
      obj.material = obj.material.map(processMat);
    } else {
      obj.material = processMat(obj.material);
    }
  });

  return { flameMeshes };
}
