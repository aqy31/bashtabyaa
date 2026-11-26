import * as THREE from 'three';

/**
 * Procedural Stormy Overcast Sky Dome + Matching PMREM Environment Map +
 * Low-Lying Drifting Tigris Valley Mist (zero volumetric raymarching cost!).
 */
export function createSkyAndAtmosphere(scene, renderer) {
  const skyUniforms = {
    uTime: { value: 0 },
  };

  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: skyUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWorldDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldDir = normalize(position);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorldDir;

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
      float fbm(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
        for (int i = 0; i < 5; i++) {
          v += a * noise(p);
          p = r * p * 2.02 + vec2(13.2, 7.8);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vWorldDir);
        float h = clamp(d.y, 0.0, 1.0);

        // Exact Blender storm sky color ramp:
        // misty silver-amber horizon -> stormy blue-grey -> brooding storm zenith
        vec3 cHorizon = vec3(0.31, 0.35, 0.39);
        vec3 cBreak   = vec3(0.40, 0.42, 0.44);
        vec3 cMid     = vec3(0.14, 0.19, 0.26);
        vec3 cZenith  = vec3(0.055, 0.085, 0.13);

        vec3 col = mix(cHorizon, cBreak, smoothstep(0.0, 0.14, h));
        col = mix(col, cMid, smoothstep(0.14, 0.45, h));
        col = mix(col, cZenith, smoothstep(0.45, 0.88, h));

        // Drifting storm cloud patches
        vec2 cloudUV = d.xz / (h + 0.22) * 1.45 + vec2(uTime * 0.012, uTime * 0.004);
        float c = fbm(cloudUV);
        float cloudShade = mix(0.56, 1.24, smoothstep(0.24, 0.78, c));
        col *= mix(1.0, cloudShade, 0.58 * smoothstep(0.02, 0.28, h));

        // Subtle overcast silver glow near sun direction
        vec3 sunDir = normalize(vec3(0.28, 0.55, 0.78));
        float sunGlow = pow(max(dot(d, sunDir), 0.0), 8.0);
        col += vec3(0.14, 0.16, 0.18) * sunGlow * (1.0 - c * 0.45);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const skyDome = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), skyMat);
  skyDome.frustumCulled = false;
  scene.add(skyDome);

  // Build PMREM Environment Map from this exact storm sky so wet stone, puddles & Tigris reflect it!
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const envScene = new THREE.Scene();
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 16), skyMat));
  const envRT = pmrem.fromScene(envScene, 0.04);
  scene.environment = envRT.texture;
  pmrem.dispose();

  // Atmospheric valley fog matching the overcast horizon
  scene.fog = new THREE.FogExp2(0x46525f, 0.0052);

  // Soft low-lying drifting river mist ribbons over the Tigris River valley
  const mistGroup = new THREE.Group();
  const mistUniforms = {
    uTime: { value: 0 },
    uOpacity: { value: 0.26 },
  };
  const mistMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    uniforms: mistUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv;
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        vDist = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpacity;
      varying vec2 vUv;
      varying float vDist;

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
        vec2 uv = vUv;
        float edge = smoothstep(0.0, 0.25, uv.x) * smoothstep(1.0, 0.75, uv.x)
                   * smoothstep(0.0, 0.35, uv.y) * smoothstep(1.0, 0.45, uv.y);
        float n1 = noise(uv * vec2(5.0, 2.5) + vec2(uTime * 0.045, 0.0));
        float n2 = noise(uv * vec2(10.0, 5.0) - vec2(uTime * 0.028, uTime * 0.01));
        float wisp = smoothstep(0.28, 0.82, n1 * 0.65 + n2 * 0.35);
        float distFade = smoothstep(8.0, 32.0, vDist) * (1.0 - smoothstep(160.0, 290.0, vDist));
        float alpha = edge * wisp * distFade * uOpacity;
        if (alpha < 0.005) discard;
        gl_FragColor = vec4(0.56, 0.63, 0.70, alpha);
      }
    `,
  });

  const mistLayers = [
    { pos: [0, 1.5, 58], size: [260, 18], rotY: 0.04 },
    { pos: [-20, 3.0, 95], size: [300, 22], rotY: -0.05 },
    { pos: [25, 0.5, 34], size: [180, 14], rotY: 0.08 },
    { pos: [-55, 4.5, 42], size: [190, 16], rotY: -0.18 },
  ];
  for (const ml of mistLayers) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(ml.size[0], ml.size[1]), mistMat);
    mesh.position.set(...ml.pos);
    mesh.rotation.y = ml.rotY;
    mistGroup.add(mesh);
  }
  scene.add(mistGroup);

  return {
    mistGroup,
    update(t) {
      skyUniforms.uTime.value = t;
      mistUniforms.uTime.value = t;
    },
    setMistVisible(visible) {
      mistGroup.visible = visible;
    },
  };
}
