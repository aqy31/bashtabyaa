import * as THREE from 'three';

/**
 * Realistic Dancing Multi-Tongue Fire Flames (on the EXACT Blender flame meshes!),
 * GPU Rising Glowing Sparks, GPU Rising Curling Fire Smoke, and Flickering Warm Lights!
 */
export function createFireAndSmokeSystem(scene, metadata, flameMeshes) {
  const timeUniform = { value: 0 };
  const fireGroup = new THREE.Group();
  const smokeGroup = new THREE.Group();
  scene.add(fireGroup);
  scene.add(smokeGroup);

  // ---------------------------------------------------------------------------
  // 1. EXACT BLENDER MULTI-TONGUE DANCING FIRE SHADER (Vertex Wind + 4D Wisps)
  // ---------------------------------------------------------------------------
  const fireMaterials = [];
  flameMeshes.forEach((mesh, idx) => {
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const minY = bb ? bb.min.y : 0.0;
    const maxY = bb ? bb.max.y : 0.74;
    const height = Math.max(0.15, maxY - minY);
    const isTorch = mesh.name.startsWith('Stair_Torch_');

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.NormalBlending,
      uniforms: {
        uTime: timeUniform,
        uMinY: { value: minY },
        uHeight: { value: height },
        uSeed: { value: idx * 2.31 },
        uStrengthXY: { value: isTorch ? 0.14 : 0.22 },
        uStrengthY: { value: isTorch ? 0.09 : 0.14 },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        uniform float uMinY;
        uniform float uHeight;
        uniform float uSeed;
        uniform float uStrengthXY;
        uniform float uStrengthY;

        varying float vHNorm;
        varying vec3 vLocalPos;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        // Smooth 3D value noise for upward-flowing wind turbulence (zero bouncing!)
        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float noise3(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
                mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }

        void main() {
          float hNorm = clamp((position.y - uMinY) / uHeight, 0.0, 1.0);
          vHNorm = hNorm;
          vLocalPos = position;

          // Pin bottom 14% solidly inside the coals; smooth upward flow toward tips!
          float tipWeight = hNorm <= 0.14 ? 0.0 : pow((hNorm - 0.14) / 0.86, 1.45);

          vec3 p = position * 2.6 + vec3(uSeed, -uTime * 5.2, uSeed * 0.7);
          float wx = (noise3(p) - 0.5) * 2.0 + 0.45 * sin(uTime * 7.5 - hNorm * 5.0 + uSeed);
          float wz = (noise3(p + vec3(11.3, 4.7, 8.2)) - 0.5) * 2.0 + 0.40 * cos(uTime * 6.8 - hNorm * 4.5 + uSeed);
          float wy = (noise3(p * 1.3 + vec3(5.1, -uTime * 1.8, 2.4)) - 0.46) * 2.0;

          vec3 displaced = position;
          // Subtle constant storm wind lean (+X, -Z) + turbulent licking motion
          displaced.x += (wx * uStrengthXY + 0.08 * hNorm) * tipWeight;
          displaced.z += (wz * uStrengthXY - 0.04 * hNorm) * tipWeight;
          displaced.y += wy * uStrengthY * tipWeight;

          vec4 mvPos = modelViewMatrix * vec4(displaced, 1.0);
          vNormalView = normalize(normalMatrix * normal);
          vViewDir = normalize(-mvPos.xyz);
          gl_Position = projectionMatrix * mvPos;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uSeed;

        varying float vHNorm;
        varying vec3 vLocalPos;
        varying vec3 vNormalView;
        varying vec3 vViewDir;

        float hash31(vec3 p) {
          p = fract(p * 0.1031);
          p += dot(p, p.yzx + 33.33);
          return fract((p.x + p.y) * p.z);
        }
        float noise3(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(hash31(i + vec3(0,0,0)), hash31(i + vec3(1,0,0)), f.x),
                mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
            mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
                mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y),
            f.z
          );
        }
        float fbm3(vec3 p) {
          float v = 0.0;
          float a = 0.5;
          for (int i = 0; i < 4; i++) {
            v += a * noise3(p);
            p = p * 2.05 + vec3(3.1, 1.7, 5.3);
            a *= 0.5;
          }
          return v;
        }

        void main() {
          // Upward-scrolling turbulent fire wisps matching Blender Mat_Realistic_Fire
          vec3 nCoord = vec3(vLocalPos.x * 6.5, vHNorm * 3.0 - uTime * 3.8, vLocalPos.z * 6.5) + vec3(uSeed);
          float turb = fbm3(nCoord);

          float baseGrad = 1.0 - vHNorm * 1.12;
          float turbAmp = 0.52 + 0.85 * vHNorm;
          float fireCore = baseGrad + (turb - 0.48) * turbAmp;

          // Soft Fresnel grazing feathering so flame tongues feel like glowing hot gas
          float facing = abs(dot(normalize(vNormalView), normalize(vViewDir)));
          float edgeSoft = mix(0.42, 1.0, pow(facing, 0.65));
          float density = fireCore * edgeSoft;

          float alpha = smoothstep(0.14, 0.48, density) * 0.95;
          if (alpha < 0.02) discard;

          // Calibrated AgX blackbody fire palette: deep crimson tips -> fiery orange -> golden-amber core
          vec3 cTip  = vec3(0.55, 0.02, 0.002);
          vec3 cMid1 = vec3(1.00, 0.14, 0.004);
          vec3 cMid2 = vec3(1.00, 0.42, 0.015);
          vec3 cCore = vec3(1.00, 0.82, 0.18);

          vec3 col = mix(cTip, cMid1, smoothstep(0.14, 0.38, fireCore));
          col = mix(col, cMid2, smoothstep(0.38, 0.66, fireCore));
          col = mix(col, cCore, smoothstep(0.66, 0.92, fireCore));

          float boost = mix(1.25, 2.55, smoothstep(0.15, 0.92, fireCore));
          gl_FragColor = vec4(col * boost, alpha);
        }
      `,
    });

    mesh.material = mat;
    mesh.renderOrder = 3;
    fireMaterials.push(mat);
  });

  // ---------------------------------------------------------------------------
  // 2. ALL FIRE SOURCES (9 Braziers + 4 Stair Torches)
  // ---------------------------------------------------------------------------
  const allSources = [
    ...metadata.braziers.map((b) => ({ ...b, isTorch: false })),
    ...metadata.torches.map((t) => ({ ...t, isTorch: true })),
  ];

  // ---------------------------------------------------------------------------
  // 3. GPU RISING GLOWING SPARKS (1 single draw call for all 13 fire sources!)
  // ---------------------------------------------------------------------------
  const sparksPerSource = 14;
  const totalSparks = allSources.length * sparksPerSource;
  const sparkPos = new Float32Array(totalSparks * 3);
  const sparkSeed = new Float32Array(totalSparks * 3);

  let sIdx = 0;
  allSources.forEach((src, i) => {
    for (let k = 0; k < sparksPerSource; k++) {
      const spread = src.isTorch ? 0.14 : 0.28;
      sparkPos[sIdx * 3 + 0] = src.flame[0] + (Math.random() - 0.5) * spread;
      sparkPos[sIdx * 3 + 1] = src.flame[1] + 0.15;
      sparkPos[sIdx * 3 + 2] = src.flame[2] + (Math.random() - 0.5) * spread;
      sparkSeed[sIdx * 3 + 0] = Math.random(); // phase
      sparkSeed[sIdx * 3 + 1] = 0.65 + Math.random() * 0.95; // speed
      sparkSeed[sIdx * 3 + 2] = src.isTorch ? 0.8 : 1.35; // max rise height
      sIdx++;
    }
  });

  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  sparkGeo.setAttribute('aSeed', new THREE.BufferAttribute(sparkSeed, 3));

  const sparkMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: timeUniform,
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vLife;

      void main() {
        float life = fract(uTime * 0.42 * aSeed.y + aSeed.x);
        vLife = life;

        vec3 p = position;
        float h = life * aSeed.z;
        p.y += h;
        // Wind drift + gentle helical ember swirl
        p.x += h * 0.24 + sin(uTime * 3.5 + aSeed.x * 20.0) * 0.08 * life;
        p.z -= h * 0.12 + cos(uTime * 3.1 + aSeed.x * 17.0) * 0.08 * life;

        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPos;
        float size = mix(4.2, 1.4, life) * uPixelRatio;
        gl_PointSize = clamp(size * (14.0 / max(-mvPos.z, 1.0)), 1.5, 11.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float glow = pow(1.0 - d * 2.0, 2.0);
        float fade = smoothstep(0.0, 0.12, vLife) * (1.0 - smoothstep(0.65, 1.0, vLife));
        vec3 col = mix(vec3(1.0, 0.78, 0.22), vec3(1.0, 0.24, 0.02), vLife);
        gl_FragColor = vec4(col * 2.4, glow * fade);
      }
    `,
  });

  const sparksPoints = new THREE.Points(sparkGeo, sparkMat);
  sparksPoints.frustumCulled = false;
  sparksPoints.renderOrder = 4;
  fireGroup.add(sparksPoints);

  // ---------------------------------------------------------------------------
  // 4. REALISTIC RISING CURLING FIRE SMOKE (الدخان - 1 single GPU draw call!)
  // ---------------------------------------------------------------------------
  const puffsPerSource = 14;
  const totalPuffs = allSources.length * puffsPerSource;
  const smokePos = new Float32Array(totalPuffs * 3);
  const smokeSeed = new Float32Array(totalPuffs * 4);

  let smIdx = 0;
  allSources.forEach((src) => {
    for (let k = 0; k < puffsPerSource; k++) {
      smokePos[smIdx * 3 + 0] = src.flame[0];
      smokePos[smIdx * 3 + 1] = src.flame[1] + (src.isTorch ? 0.35 : 0.58);
      smokePos[smIdx * 3 + 2] = src.flame[2];
      smokeSeed[smIdx * 4 + 0] = k / puffsPerSource + Math.random() * 0.06; // phase
      smokeSeed[smIdx * 4 + 1] = 0.26 + Math.random() * 0.12; // speed
      smokeSeed[smIdx * 4 + 2] = src.isTorch ? 2.4 : 4.2; // rise height
      smokeSeed[smIdx * 4 + 3] = src.isTorch ? 0.55 : 1.0; // scale factor
      smIdx++;
    }
  });

  const smokeGeo = new THREE.BufferGeometry();
  smokeGeo.setAttribute('position', new THREE.BufferAttribute(smokePos, 3));
  smokeGeo.setAttribute('aSeed', new THREE.BufferAttribute(smokeSeed, 4));

  const smokeMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: {
      uTime: timeUniform,
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
    },
    vertexShader: /* glsl */ `
      attribute vec4 aSeed;
      uniform float uTime;
      uniform float uPixelRatio;
      varying float vLife;
      varying float vRot;
      varying float vPhase;

      void main() {
        float life = fract(uTime * aSeed.y + aSeed.x);
        vLife = life;
        vPhase = aSeed.x * 13.7;
        vRot = life * 1.6 + aSeed.x * 6.283;

        vec3 p = position;
        float h = life * aSeed.z;
        p.y += h;
        // Curling wind-blown smoke trail drifting in the Mosul storm breeze
        p.x += pow(life, 1.35) * 1.45 * aSeed.w + sin(uTime * 1.2 + life * 4.5 + vPhase) * 0.24 * life;
        p.z -= pow(life, 1.35) * 0.65 * aSeed.w + cos(uTime * 1.1 + life * 4.0 + vPhase) * 0.20 * life;

        vec4 mvPos = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPos;

        float baseSize = mix(0.45, 2.35, pow(life, 0.75)) * aSeed.w;
        gl_PointSize = clamp(baseSize * 280.0 * uPixelRatio / max(-mvPos.z, 1.2), 4.0, 220.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      varying float vRot;
      varying float vPhase;

      float hash(vec2 p) {
        p = fract(p * vec2(127.1, 311.7));
        p += dot(p, p + 34.5);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
          f.y
        );
      }

      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float c = cos(vRot), s = sin(vRot);
        vec2 ruv = mat2(c, -s, s, c) * uv;

        float dist = length(uv) * 2.0;
        if (dist > 1.0) discard;

        float n = noise(ruv * 4.2 + vec2(vPhase, vLife * 1.5)) * 0.65
                + noise(ruv * 8.5 - vec2(vPhase * 0.5, vLife * 2.4)) * 0.35;
        float radial = pow(1.0 - dist, 1.75);
        float wisp = smoothstep(0.18, 0.85, n * 0.85 + radial * 0.45);
        float lifeFade = smoothstep(0.0, 0.16, vLife) * (1.0 - smoothstep(0.45, 1.0, vLife));

        // Subtle warm fire under-glow at the base of the smoke fading into cool dark rainy smoke above!
        vec3 warmBase = vec3(0.48, 0.22, 0.10);
        vec3 coolSmoke = vec3(0.24, 0.27, 0.31);
        vec3 col = mix(warmBase, coolSmoke, smoothstep(0.0, 0.32, vLife));

        float alpha = radial * wisp * lifeFade * 0.34;
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });

  const smokePoints = new THREE.Points(smokeGeo, smokeMat);
  smokePoints.frustumCulled = false;
  smokePoints.renderOrder = 2;
  smokeGroup.add(smokePoints);

  // ---------------------------------------------------------------------------
  // 5. WARM FLICKERING POINT LIGHTS (All 13 Braziers & Torches!)
  // ---------------------------------------------------------------------------
  const fireLights = [];
  allSources.forEach((src, idx) => {
    // Convert Blender Watts to Three.js candela-like intensity with distance falloff
    const baseIntensity = src.power * 0.22;
    const distance = src.isTorch ? 18 : 26;
    const light = new THREE.PointLight(0xff701a, baseIntensity, distance, 1.6);
    light.position.set(src.light[0], src.light[1], src.light[2]);
    light.castShadow = false; // Sun casts shadows; point lights stay ultra-fast 60 FPS!
    fireGroup.add(light);
    fireLights.push({
      light,
      baseIntensity,
      seed: idx * 2.1,
      isInner: !!src.isInner,
    });
  });

  let fireVisible = true;
  let maxActiveLights = fireLights.length;

  return {
    fireGroup,
    smokeGroup,
    update(t, cameraPos) {
      timeUniform.value = t;
      if (!fireVisible) return;

      // Flicker every fire light organically matching Blender's driver expression
      for (let i = 0; i < fireLights.length; i++) {
        const fl = fireLights[i];
        const flicker = 0.86 + 0.15 * Math.sin(t * 14.0 + fl.seed) + 0.08 * Math.cos(t * 29.0 + fl.seed * 0.5);
        fl.light.intensity = fl.baseIntensity * flicker;
      }

      // In lower quality modes, keep the closest N lights active for maximum FPS
      if (maxActiveLights < fireLights.length && cameraPos) {
        const ranked = fireLights
          .map((fl, idx) => ({ idx, d2: fl.light.position.distanceToSquared(cameraPos) }))
          .sort((a, b) => a.d2 - b.d2);
        for (let r = 0; r < ranked.length; r++) {
          fireLights[ranked[r].idx].light.visible = r < maxActiveLights;
        }
      } else {
        for (let i = 0; i < fireLights.length; i++) {
          fireLights[i].light.visible = true;
        }
      }
    },
    setFireVisible(v) {
      fireVisible = v;
      fireGroup.visible = v;
      flameMeshes.forEach((m) => (m.visible = v));
    },
    setSmokeVisible(v) {
      smokeGroup.visible = v;
    },
    setQuality(level) {
      maxActiveLights = level === 'high' ? fireLights.length : level === 'balanced' ? 8 : 5;
    },
  };
}
