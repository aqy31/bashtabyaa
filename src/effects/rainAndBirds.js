import * as THREE from 'three';

/**
 * 3-Layer Camera-Anchored Falling Rain (100% GPU Vertex Shader, zero CPU cost!)
 * + 9 Circling Mosul Birds with animated wing-flapping!
 */
export function createRainSystem(scene) {
  const rainGroup = new THREE.Group();
  scene.add(rainGroup);

  const rainUniforms = {
    uTime: { value: 0 },
    uCamPos: { value: new THREE.Vector3() },
    uOpacity: { value: 0.34 },
  };

  // Exact 3 layers matching build_cinematic_scene.py:
  // close delicate streaks, midground rain curtain, distant atmospheric rain sheets
  const layerSpecs = [
    { count: 750, zSpan: 22.0, speed: 24.0, rMin: 1.8, rMax: 12.0, dropLen: 0.55 },
    { count: 1050, zSpan: 30.0, speed: 30.0, rMin: 10.0, rMax: 28.0, dropLen: 0.85 },
    { count: 850, zSpan: 40.0, speed: 35.0, rMin: 24.0, rMax: 52.0, dropLen: 1.25 },
  ];

  // Combine all 3 layers into ONE single ultra-fast LineSegments draw call!
  let totalDrops = 0;
  layerSpecs.forEach((l) => (totalDrops += l.count));

  const positions = new Float32Array(totalDrops * 2 * 3);
  const metaAttr = new Float32Array(totalDrops * 2 * 4); // [zSpan, speed, dropLen, isTop]

  let ptr = 0;
  for (const spec of layerSpecs) {
    for (let i = 0; i < spec.count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(spec.rMin * spec.rMin + Math.random() * (spec.rMax * spec.rMax - spec.rMin * spec.rMin));
      const x = Math.cos(ang) * rr;
      const z = Math.sin(ang) * rr;
      const y = Math.random() * spec.zSpan;
      const len = spec.dropLen * (0.75 + Math.random() * 0.55);

      for (let v = 0; v < 2; v++) {
        positions[ptr * 3 + 0] = x;
        positions[ptr * 3 + 1] = y;
        positions[ptr * 3 + 2] = z;
        metaAttr[ptr * 4 + 0] = spec.zSpan;
        metaAttr[ptr * 4 + 1] = spec.speed * (0.9 + Math.random() * 0.2);
        metaAttr[ptr * 4 + 2] = len;
        metaAttr[ptr * 4 + 3] = v; // 0 = bottom, 1 = top
        ptr++;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aMeta', new THREE.BufferAttribute(metaAttr, 4));

  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: rainUniforms,
    vertexShader: /* glsl */ `
      attribute vec4 aMeta;
      uniform float uTime;
      uniform vec3 uCamPos;
      varying float vFade;

      void main() {
        float span = aMeta.x;
        float speed = aMeta.y;
        float len = aMeta.z;
        float isTop = aMeta.w;

        // Seamless GPU vertical modulo wrap around camera Y
        float localY = mod(position.y - uTime * speed, span) - span * 0.5;

        // Subtle wind slant matching Blender's Rain_World_Anchor (7 deg X, -5 deg Z)
        vec3 slant = vec3(-0.11, 1.0, 0.08);
        vec3 offset = vec3(position.x, localY, position.z) + slant * (isTop * len);

        // Anchor around camera position in world space
        vec3 worldPos = uCamPos + offset;

        // Fade near top/bottom of wrap box & very close to camera lens
        float yEdge = 1.0 - smoothstep(span * 0.34, span * 0.5, abs(localY));
        float dist = length(offset.xz);
        float nearFade = smoothstep(1.2, 3.0, dist);
        vFade = yEdge * nearFade * (isTop > 0.5 ? 0.55 : 1.0);

        gl_Position = projectionMatrix * viewMatrix * vec4(worldPos, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying float vFade;
      void main() {
        float a = vFade * uOpacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(0.75, 0.82, 0.89, a);
      }
    `,
  });

  const rainMesh = new THREE.LineSegments(geo, mat);
  rainMesh.frustumCulled = false;
  rainMesh.renderOrder = 5;
  rainGroup.add(rainMesh);

  let intensity = 1.0;

  return {
    rainGroup,
    update(t, camPos) {
      rainUniforms.uTime.value = t;
      rainUniforms.uCamPos.value.copy(camPos);
    },
    setVisible(v) {
      rainGroup.visible = v;
    },
    setIntensity(val) {
      intensity = val;
      rainUniforms.uOpacity.value = 0.34 * val;
      // Draw only a proportional fraction of raindrops for clean visual scaling & extra FPS
      const countVerts = Math.floor(Math.min(1.0, Math.max(0.15, val * 0.72)) * totalDrops) * 2;
      geo.setDrawRange(0, countVerts);
    },
    setQuality(level) {
      const mult = level === 'high' ? 1.0 : level === 'balanced' ? 0.65 : 0.38;
      const countVerts = Math.floor(Math.min(1.0, intensity * mult) * totalDrops) * 2;
      geo.setDrawRange(0, countVerts);
    },
  };
}

/**
 * 9 Poetic Circling Mosul Birds gliding slowly over Bash Tapia & the Tigris River
 * using the exact exported Mosul_Bird_Template geometry with GPU wing-flapping!
 */
export function createCirclingBirds(scene, templateObj) {
  const group = new THREE.Group();
  scene.add(group);

  let birdGeo = null;
  if (templateObj && templateObj.isMesh) {
    birdGeo = templateObj.geometry.clone();
    templateObj.visible = false;
  } else {
    // Fallback graceful bird silhouette if template wasn't found
    birdGeo = new THREE.ConeGeometry(0.18, 0.6, 4);
    birdGeo.rotateX(Math.PI * 0.5);
  }

  const timeUniform = { value: 0 };
  const birds = [];

  for (let i = 0; i < 9; i++) {
    const flapSpeed = 5.5 + (i % 4) * 0.85;
    const flapPhase = i * 1.73;

    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.13, 0.14, 0.16),
      roughness: 0.65,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = timeUniform;
      shader.uniforms.uFlapSpeed = { value: flapSpeed };
      shader.uniforms.uFlapPhase = { value: flapPhase };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uTime;\nuniform float uFlapSpeed;\nuniform float uFlapPhase;'
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           float wingDist = max(0.0, abs(position.x) - 0.12);
           float flap = sin(uTime * uFlapSpeed + uFlapPhase);
           transformed.y += wingDist * flap * 0.68;`
        );
    };

    const mesh = new THREE.Mesh(birdGeo, mat);
    const scale = 0.9 + (i % 3) * 0.18;
    mesh.scale.setScalar(scale);
    group.add(mesh);

    // Deterministic circling parameters matching build_cinematic_scene.py (converted to Y-up)
    const dir = i % 2 === 0 ? 1 : -1;
    birds.push({
      mesh,
      cx: -10 + ((i * 7.3) % 32),
      cy: 19.5 + (i % 5) * 2.6,
      cz: -4 + ((i * 9.1) % 36),
      rad: 15 + (i % 4) * 5.2,
      phase: i * 0.95,
      speed: (0.11 + (i % 3) * 0.03) * dir,
      bank: dir > 0 ? -0.22 : 0.22,
    });
  }

  return {
    group,
    update(t) {
      timeUniform.value = t;
      if (!group.visible) return;
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        const ang = b.phase + t * b.speed;
        const x = b.cx + b.rad * Math.cos(ang);
        const z = b.cz + b.rad * Math.sin(ang) * 0.72;
        const y = b.cy + 1.6 * Math.sin(ang * 2.0 + i);

        const dx = -b.rad * Math.sin(ang) * b.speed;
        const dz = b.rad * Math.cos(ang) * 0.72 * b.speed;
        const yaw = Math.atan2(dx, dz);

        b.mesh.position.set(x, y, z);
        b.mesh.rotation.set(0, yaw, b.bank);
      }
    },
    setVisible(v) {
      group.visible = v;
    },
  };
}
