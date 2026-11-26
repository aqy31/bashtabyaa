import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

import { TOUR_STOPS, WALK_START } from './tourData.js';
import { upgradeCastleMaterials, sharedShaderUniforms } from './shaders/wetMaterials.js';
import { createSkyAndAtmosphere } from './effects/skyAndAtmosphere.js';
import { createFireAndSmokeSystem } from './effects/fireAndSmoke.js';
import { createRainSystem, createCirclingBirds } from './effects/rainAndBirds.js';
import { WalkPhysics } from './physics/walkPhysics.js';

// -----------------------------------------------------------------------------
// Device Detection (Mobile / Touch Auto-Optimization)
// -----------------------------------------------------------------------------
const isTouchDevice =
  window.matchMedia('(pointer: coarse)').matches ||
  'ontouchstart' in window ||
  /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

// -----------------------------------------------------------------------------
// DOM Elements
// -----------------------------------------------------------------------------
const container = document.getElementById('canvas-container');
const loaderEl = document.getElementById('loader');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const fpsBadge = document.getElementById('fps-badge');
const toastEl = document.getElementById('toast');

const hudEl = document.getElementById('hud');
const btnShowHud = document.getElementById('btn-show-hud');
const btnHideHud = document.getElementById('btn-hide-hud');
const btnFullscreen = document.getElementById('btn-fullscreen');
const btnAudio = document.getElementById('btn-audio');
const btnStops = document.getElementById('btn-stops');
const btnSettings = document.getElementById('btn-settings');

const drawerStops = document.getElementById('drawer-stops');
const drawerSettings = document.getElementById('drawer-settings');
const stopsListEl = document.getElementById('stops-list');
const walkHintEl = document.getElementById('walk-hint');
const walkHintTextEl = document.getElementById('walk-hint-text');
const btnCloseHint = document.getElementById('btn-close-hint');

const mobileControlsEl = document.getElementById('mobile-controls');
const joystickZone = document.getElementById('joystick-zone');
const joystickKnob = document.getElementById('joystick-knob');
const btnMobileJump = document.getElementById('btn-mobile-jump');
const btnMobileSprint = document.getElementById('btn-mobile-sprint');
const toggleTouchControls = document.getElementById('toggle-touch-controls');

const shotBanner = document.getElementById('shot-banner');
const shotIndexEl = document.getElementById('shot-index');
const shotTitleEl = document.getElementById('shot-title');
const shotDescEl = document.getElementById('shot-desc');
const tourProgressFill = document.getElementById('tour-progress-fill');

const modeTabs = document.getElementById('mode-tabs');
const tourControlsEl = document.getElementById('tour-controls');
const btnPrev = document.getElementById('btn-prev');
const btnPlay = document.getElementById('btn-play');
const btnNext = document.getElementById('btn-next');

// -----------------------------------------------------------------------------
// Toast & Auto-Fading Hint Helpers
// -----------------------------------------------------------------------------
let toastTimer = null;
function showToast(msg, durationMs = 2600) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden', 'fade-out');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add('fade-out');
    setTimeout(() => toastEl.classList.add('hidden'), 420);
  }, durationMs);
}

let hintTimer = null;
function showWalkHintTemporarily() {
  if (isTouchDevice || toggleTouchControls.checked) {
    walkHintTextEl.innerHTML =
      '<strong>وضع التجول مشياً:</strong> استخدم عصا التحكم للمشي • اسحب الشاشة للالتفات • اضغط <strong>قفز</strong> للقفز';
  } else {
    walkHintTextEl.innerHTML =
      '<strong>وضع التجول مشياً:</strong> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> للمشي • اسحب بالفأرة للالتفات • <kbd>Space</kbd> للقفز • <kbd>Shift</kbd> للركض';
  }
  walkHintEl.classList.remove('hidden', 'fade-out');
  clearTimeout(hintTimer);
  hintTimer = setTimeout(dismissWalkHint, 5500);
}

function dismissWalkHint() {
  clearTimeout(hintTimer);
  if (walkHintEl.classList.contains('hidden')) return;
  walkHintEl.classList.add('fade-out');
  setTimeout(() => {
    if (walkHintEl.classList.contains('fade-out')) {
      walkHintEl.classList.add('hidden');
    }
  }, 650);
}
btnCloseHint.addEventListener('click', dismissWalkHint);

// -----------------------------------------------------------------------------
// Renderer, Scene, Camera, Post-Processing
// -----------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({
  antialias: !isTouchDevice,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isTouchDevice ? 1.25 : 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.2, 650);
camera.position.set(...TOUR_STOPS[0].camStart);

// Post-processing composer for cinematic fire/ember bloom
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.34,
  0.55,
  1.15
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

let useBloom = !isTouchDevice;
let lookSensitivity = 1.0;

// -----------------------------------------------------------------------------
// Controls (Orbit + Physical First-Person Walkthrough + Mobile Joystick)
// -----------------------------------------------------------------------------
const orbitControls = new OrbitControls(camera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.06;
orbitControls.maxDistance = 160;
orbitControls.minDistance = 2.0;
orbitControls.maxPolarAngle = Math.PI * 0.495;
orbitControls.target.set(...TOUR_STOPS[0].targetStart);
orbitControls.enabled = false;

const walkState = {
  keys: new Set(),
  lookPointerId: null,
  lastX: 0,
  lastY: 0,
  yaw: 0,
  pitch: 0,
  joyX: 0,      // -1..1 from virtual joystick
  joyY: 0,      // -1..1 from virtual joystick (forward = +1)
  mobileSprint: false,
  movedTime: 0,
};

// Pointer drag on canvas to look around in Walkthrough mode (works seamlessly with multi-touch!)
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (appState.mode !== 'walk') return;
  if (walkState.lookPointerId !== null) return;
  walkState.lookPointerId = e.pointerId;
  walkState.lastX = e.clientX;
  walkState.lastY = e.clientY;
});
window.addEventListener('pointermove', (e) => {
  if (appState.mode !== 'walk' || e.pointerId !== walkState.lookPointerId) return;
  const dx = e.clientX - walkState.lastX;
  const dy = e.clientY - walkState.lastY;
  walkState.lastX = e.clientX;
  walkState.lastY = e.clientY;
  const mult = (isTouchDevice ? 0.0052 : 0.0038) * lookSensitivity;
  walkState.yaw -= dx * mult;
  walkState.pitch = Math.max(-1.25, Math.min(1.25, walkState.pitch - dy * mult));
});
const releaseLookPointer = (e) => {
  if (e.pointerId === walkState.lookPointerId) {
    walkState.lookPointerId = null;
  }
};
window.addEventListener('pointerup', releaseLookPointer);
window.addEventListener('pointercancel', releaseLookPointer);

// Virtual Touch Joystick (multi-touch safe via pointerId!)
let joyPointerId = null;
let joyCenter = { x: 0, y: 0 };
const JOY_MAX_R = 42;

function updateJoystickFromClient(clientX, clientY) {
  const dx = clientX - joyCenter.x;
  const dy = clientY - joyCenter.y;
  const dist = Math.hypot(dx, dy);
  const clamped = Math.min(dist, JOY_MAX_R);
  const ang = Math.atan2(dy, dx);
  const kx = Math.cos(ang) * clamped;
  const ky = Math.sin(ang) * clamped;
  joystickKnob.style.transform = `translate(${kx.toFixed(1)}px, ${ky.toFixed(1)}px)`;
  walkState.joyX = kx / JOY_MAX_R;
  walkState.joyY = -ky / JOY_MAX_R; // Up on joystick = walk forward (+1)
}

joystickZone.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  if (joyPointerId !== null) return;
  joyPointerId = e.pointerId;
  joystickZone.setPointerCapture?.(e.pointerId);
  const rect = joystickZone.getBoundingClientRect();
  joyCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  updateJoystickFromClient(e.clientX, e.clientY);
});

joystickZone.addEventListener('pointermove', (e) => {
  if (e.pointerId !== joyPointerId) return;
  e.stopPropagation();
  e.preventDefault();
  updateJoystickFromClient(e.clientX, e.clientY);
});

const resetJoystick = (e) => {
  if (e.pointerId !== joyPointerId) return;
  joyPointerId = null;
  walkState.joyX = 0;
  walkState.joyY = 0;
  joystickKnob.style.transform = 'translate(0px, 0px)';
};
joystickZone.addEventListener('pointerup', resetJoystick);
joystickZone.addEventListener('pointercancel', resetJoystick);

btnMobileJump.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  walkPhysics?.jump();
});

btnMobileSprint.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  e.preventDefault();
  walkState.mobileSprint = !walkState.mobileSprint;
  btnMobileSprint.classList.toggle('active', walkState.mobileSprint);
});

// -----------------------------------------------------------------------------
// Lighting (Moody Overcast Storm Sun + Soft Sky/Earth Hemisphere)
// -----------------------------------------------------------------------------
const hemiLight = new THREE.HemisphereLight(0x8ba2ba, 0x26292e, 0.72);
scene.add(hemiLight);

const sunLight = new THREE.DirectionalLight(0xc7dbf5, 1.85);
sunLight.position.set(28, 52, 46);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(isTouchDevice ? 1024 : 2048, isTouchDevice ? 1024 : 2048);
sunLight.shadow.camera.near = 5;
sunLight.shadow.camera.far = 190;
const shadowExtent = 58;
sunLight.shadow.camera.left = -shadowExtent;
sunLight.shadow.camera.right = shadowExtent;
sunLight.shadow.camera.top = shadowExtent;
sunLight.shadow.camera.bottom = -shadowExtent;
sunLight.shadow.bias = -0.0005;
scene.add(sunLight);

// -----------------------------------------------------------------------------
// Sky, Atmosphere, Rain, Physics
// -----------------------------------------------------------------------------
const skySystem = createSkyAndAtmosphere(scene, renderer);
const rainSystem = createRainSystem(scene);
let fireSystem = null;
let birdSystem = null;
let walkPhysics = null;

// -----------------------------------------------------------------------------
// App & Tour State
// -----------------------------------------------------------------------------
const appState = {
  mode: 'tour', // 'tour' | 'orbit' | 'walk'
  playing: true,
  stopIndex: 0,
  stopElapsed: 0,
  flyTo: null,
};

// Ambient looping audio
const ambientAudio = new Audio('./assets/ambient_rain_fire.mp3');
ambientAudio.loop = true;
ambientAudio.volume = 0.55;
let audioOn = false;

function toggleAudio() {
  if (!audioOn) {
    ambientAudio
      .play()
      .then(() => {
        audioOn = true;
        btnAudio.querySelector('.ico').textContent = '🔊';
        btnAudio.classList.add('active');
      })
      .catch(() => {});
  } else {
    ambientAudio.pause();
    audioOn = false;
    btnAudio.querySelector('.ico').textContent = '🔇';
    btnAudio.classList.remove('active');
  }
}

// -----------------------------------------------------------------------------
// Tour & Navigation Helpers
// -----------------------------------------------------------------------------
function smoothstep01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function updateShotUI() {
  const stop = TOUR_STOPS[appState.stopIndex];
  shotIndexEl.textContent = `${appState.stopIndex + 1} / ${TOUR_STOPS.length}`;
  shotTitleEl.textContent = stop.title;
  shotDescEl.textContent = stop.desc;

  document.querySelectorAll('.stop-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === appState.stopIndex);
  });
}

function syncWalkAnglesFromLook(targetVec) {
  const dir = targetVec.clone().sub(camera.position).normalize();
  walkState.yaw = Math.atan2(-dir.x, -dir.z);
  walkState.pitch = Math.asin(Math.max(-0.95, Math.min(0.95, dir.y)));
}

function updateMobileControlsVisibility() {
  const show = appState.mode === 'walk' && toggleTouchControls.checked;
  mobileControlsEl.classList.toggle('hidden', !show);
}

function goToStop(index, resetProgress = true) {
  appState.stopIndex = (index + TOUR_STOPS.length) % TOUR_STOPS.length;
  if (resetProgress) appState.stopElapsed = 0;
  updateShotUI();

  const stop = TOUR_STOPS[appState.stopIndex];
  if (appState.mode === 'orbit') {
    appState.flyTo = {
      t: 0,
      duration: 1.4,
      fromPos: camera.position.clone(),
      toPos: new THREE.Vector3(...stop.camStart),
      fromTgt: orbitControls.target.clone(),
      toTgt: new THREE.Vector3(...stop.targetStart),
    };
  } else if (appState.mode === 'walk') {
    const startVec = new THREE.Vector3(...stop.camStart);
    camera.position.copy(startVec);
    walkPhysics?.teleportToEye(startVec);
    syncWalkAnglesFromLook(new THREE.Vector3(...stop.targetStart));
  }
}

function setMode(newMode) {
  appState.mode = newMode;
  appState.flyTo = null;
  walkState.movedTime = 0;

  modeTabs.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === newMode);
  });

  orbitControls.enabled = newMode === 'orbit';
  tourControlsEl.classList.toggle('hidden', newMode !== 'tour');
  shotBanner.classList.toggle('hidden', newMode !== 'tour');
  updateMobileControlsVisibility();

  if (newMode === 'orbit') {
    dismissWalkHint();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    orbitControls.target.copy(camera.position).addScaledVector(forward, 18);
    orbitControls.update();
  } else if (newMode === 'walk') {
    const startPos = new THREE.Vector3(...WALK_START.position);
    camera.position.copy(startPos);
    camera.fov = isTouchDevice ? 60 : 54;
    camera.updateProjectionMatrix();
    walkPhysics?.teleportToEye(startPos);
    syncWalkAnglesFromLook(new THREE.Vector3(...WALK_START.lookAt));
    showWalkHintTemporarily();
  } else if (newMode === 'tour') {
    dismissWalkHint();
    updateShotUI();
  }
}

// Build Stops List Drawer
TOUR_STOPS.forEach((stop, idx) => {
  const btn = document.createElement('button');
  btn.className = 'stop-item' + (idx === 0 ? ' active' : '');
  btn.innerHTML = `
    <div class="stop-item-title">${idx + 1}. ${stop.title}</div>
    <div class="stop-item-sub">${stop.desc}</div>
  `;
  btn.addEventListener('click', () => {
    goToStop(idx, true);
    if (window.innerWidth < 800) drawerStops.classList.add('hidden');
  });
  stopsListEl.appendChild(btn);
});

// -----------------------------------------------------------------------------
// Quality Preset Helper
// -----------------------------------------------------------------------------
function applyQualityPreset(q) {
  document.querySelectorAll('#quality-segmented button').forEach((b) => {
    b.classList.toggle('active', b.dataset.quality === q);
  });

  const bloomToggle = document.getElementById('toggle-bloom');
  if (q === 'high') {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    useBloom = bloomToggle.checked;
    renderer.shadowMap.enabled = true;
  } else if (q === 'balanced') {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
    useBloom = !isTouchDevice && bloomToggle.checked;
    renderer.shadowMap.enabled = true;
  } else {
    renderer.setPixelRatio(1.0);
    useBloom = false;
    renderer.shadowMap.enabled = false;
  }
  composer.setSize(window.innerWidth, window.innerHeight);
  rainSystem.setQuality(q);
  fireSystem?.setQuality(q);
}

// Initialize defaults for mobile vs desktop
toggleTouchControls.checked = isTouchDevice;
if (isTouchDevice) {
  document.getElementById('toggle-bloom').checked = false;
  applyQualityPreset('balanced');
}

// -----------------------------------------------------------------------------
// Load Full-Detail Draco GLB + Scene Metadata
// -----------------------------------------------------------------------------
async function loadSceneAssets() {
  const metaRes = await fetch('./assets/scene_metadata.json');
  const metadata = await metaRes.json();

  if (metadata.sun && metadata.sun.direction) {
    const [dx, dy, dz] = metadata.sun.direction;
    sunLight.position.set(-dx * 65, -dy * 65, -dz * 65);
  }

  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath('./draco/');

  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  gltfLoader.load(
    './assets/bashtapia_castle.glb',
    (gltf) => {
      const root = gltf.scene;

      const { flameMeshes } = upgradeCastleMaterials(root);
      scene.add(root);

      fireSystem = createFireAndSmokeSystem(scene, metadata, flameMeshes);
      if (isTouchDevice) fireSystem.setQuality('balanced');

      const birdTemplate = root.getObjectByName('Mosul_Bird_Template');
      birdSystem = createCirclingBirds(scene, birdTemplate);

      // Initialize real physical ground, stair, wall collision & falling engine
      walkPhysics = new WalkPhysics(root, WALK_START.position);

      updateShotUI();
      progressBar.style.width = '100%';
      progressText.textContent = 'اكتمل التحميل! مرحباً بك في قلعة باشطابيا';
      setTimeout(() => {
        loaderEl.classList.add('fade-out');
      }, 320);
    },
    (xhr) => {
      if (xhr.total > 0) {
        const pct = Math.min(99, Math.round((xhr.loaded / xhr.total) * 100));
        progressBar.style.width = `${pct}%`;
        progressText.textContent = `جاري تحميل المجسم الكامل... ${pct}%`;
      }
    },
    (err) => {
      console.error('Failed to load Bash Tapia GLB:', err);
      progressText.textContent = 'حدث خطأ أثناء تحميل المجسم. يرجى إعادة المحاولة.';
    }
  );
}

// -----------------------------------------------------------------------------
// UI Event Wiring
// -----------------------------------------------------------------------------
modeTabs.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-mode]');
  if (btn) setMode(btn.dataset.mode);
});

btnPlay.addEventListener('click', () => {
  appState.playing = !appState.playing;
  btnPlay.textContent = appState.playing ? '⏸' : '▶';
});
btnPrev.addEventListener('click', () => goToStop(appState.stopIndex - 1, true));
btnNext.addEventListener('click', () => goToStop(appState.stopIndex + 1, true));
btnAudio.addEventListener('click', toggleAudio);

btnStops.addEventListener('click', () => {
  drawerSettings.classList.add('hidden');
  drawerStops.classList.toggle('hidden');
});
btnSettings.addEventListener('click', () => {
  drawerStops.classList.add('hidden');
  drawerSettings.classList.toggle('hidden');
});

document.querySelectorAll('.close-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.getElementById(btn.dataset.close)?.classList.add('hidden');
  });
});

function setHudHidden(hide) {
  hudEl.classList.toggle('hud-hidden', hide);
  btnShowHud.classList.toggle('hidden', !hide);
}
btnHideHud.addEventListener('click', () => setHudHidden(true));
btnShowHud.addEventListener('click', () => setHudHidden(false));

btnFullscreen.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.();
  } else {
    document.exitFullscreen?.();
  }
});

document.getElementById('quality-segmented').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-quality]');
  if (btn) applyQualityPreset(btn.dataset.quality);
});

toggleTouchControls.addEventListener('change', updateMobileControlsVisibility);

document.getElementById('toggle-rain').addEventListener('change', (e) => {
  rainSystem.setVisible(e.target.checked);
});
document.getElementById('toggle-fire').addEventListener('change', (e) => {
  fireSystem?.setFireVisible(e.target.checked);
});
document.getElementById('toggle-smoke').addEventListener('change', (e) => {
  fireSystem?.setSmokeVisible(e.target.checked);
  skySystem.setMistVisible(e.target.checked);
});
document.getElementById('toggle-puddles').addEventListener('change', (e) => {
  sharedShaderUniforms.uPuddleEnabled.value = e.target.checked ? 1.0 : 0.0;
});
document.getElementById('toggle-river').addEventListener('change', (e) => {
  sharedShaderUniforms.uRiverEnabled.value = e.target.checked ? 1.0 : 0.0;
});
document.getElementById('toggle-birds').addEventListener('change', (e) => {
  birdSystem?.setVisible(e.target.checked);
});
document.getElementById('toggle-bloom').addEventListener('change', (e) => {
  useBloom = e.target.checked;
});

const sliderRain = document.getElementById('slider-rain');
const rainValEl = document.getElementById('rain-val');
sliderRain.addEventListener('input', () => {
  const val = Number(sliderRain.value) / 100;
  rainValEl.textContent = `${sliderRain.value}%`;
  sharedShaderUniforms.uRainIntensity.value = val;
  rainSystem.setIntensity(val);
});

const sliderSens = document.getElementById('slider-sens');
const sensValEl = document.getElementById('sens-val');
sliderSens.addEventListener('input', () => {
  lookSensitivity = Number(sliderSens.value) / 100;
  sensValEl.textContent = `${sliderSens.value}%`;
});

// Keyboard shortcuts
window.addEventListener('keydown', (e) => {
  const code = e.code;
  walkState.keys.add(code);

  if (code === 'KeyH') {
    setHudHidden(!hudEl.classList.contains('hud-hidden'));
  } else if (code === 'Space') {
    if (appState.mode === 'tour') {
      e.preventDefault();
      appState.playing = !appState.playing;
      btnPlay.textContent = appState.playing ? '⏸' : '▶';
    } else if (appState.mode === 'walk') {
      e.preventDefault();
      walkPhysics?.jump();
    }
  } else if (code === 'Digit1') {
    setMode('tour');
  } else if (code === 'Digit2') {
    setMode('orbit');
  } else if (code === 'Digit3') {
    setMode('walk');
  }
});
window.addEventListener('keyup', (e) => {
  walkState.keys.delete(e.code);
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

// -----------------------------------------------------------------------------
// Animation Loop
// -----------------------------------------------------------------------------
const clock = new THREE.Clock();
const tmpPos = new THREE.Vector3();
const tmpTgt = new THREE.Vector3();
const tmpFwd = new THREE.Vector3();
const tmpRight = new THREE.Vector3();
const tmpMove = new THREE.Vector3();
const eulerWalk = new THREE.Euler(0, 0, 0, 'YXZ');

let fpsFrames = 0;
let fpsAccum = 0;

function onPhysicsEvent(type, intensity) {
  if (type === 'wall_bump') {
    navigator.vibrate?.(18);
  } else if (type === 'hard_land') {
    navigator.vibrate?.(Math.round(25 + intensity * 45));
  } else if (type === 'river_fall') {
    navigator.vibrate?.([40, 30, 60]);
    showToast('🌊 سقطت في نهر دجلة — تم إعادتك إلى شرفة القلعة');
  }
}

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;

  fpsFrames++;
  fpsAccum += dt;
  if (fpsAccum >= 0.5) {
    const fps = Math.round(fpsFrames / fpsAccum);
    fpsBadge.textContent = `${fps} FPS`;
    fpsBadge.style.color = fps >= 50 ? '#86efac' : fps >= 30 ? '#fcd34d' : '#fca5a5';
    fpsFrames = 0;
    fpsAccum = 0;
  }

  sharedShaderUniforms.uTime.value = elapsed;
  skySystem.update(elapsed);
  rainSystem.update(elapsed, camera.position);
  fireSystem?.update(elapsed, camera.position);
  birdSystem?.update(elapsed);

  if (appState.mode === 'tour') {
    const stop = TOUR_STOPS[appState.stopIndex];
    if (appState.playing) {
      appState.stopElapsed += dt;
      if (appState.stopElapsed >= stop.duration) {
        goToStop(appState.stopIndex + 1, true);
      }
    }
    const curStop = TOUR_STOPS[appState.stopIndex];
    const ratio = Math.min(1, appState.stopElapsed / curStop.duration);
    const ease = smoothstep01(ratio);

    tmpPos.set(...curStop.camStart).lerp(new THREE.Vector3(...curStop.camEnd), ease);
    tmpTgt.set(...curStop.targetStart).lerp(new THREE.Vector3(...curStop.targetEnd), ease);

    camera.position.copy(tmpPos);
    camera.lookAt(tmpTgt);
    if (Math.abs(camera.fov - curStop.fov) > 0.1) {
      camera.fov += (curStop.fov - camera.fov) * Math.min(1, dt * 4);
      camera.updateProjectionMatrix();
    }
    tourProgressFill.style.width = `${(ratio * 100).toFixed(1)}%`;
  } else if (appState.mode === 'orbit') {
    if (appState.flyTo) {
      appState.flyTo.t += dt / appState.flyTo.duration;
      const e = smoothstep01(appState.flyTo.t);
      camera.position.lerpVectors(appState.flyTo.fromPos, appState.flyTo.toPos, e);
      orbitControls.target.lerpVectors(appState.flyTo.fromTgt, appState.flyTo.toTgt, e);
      if (appState.flyTo.t >= 1) appState.flyTo = null;
    }
    orbitControls.update();
  } else if (appState.mode === 'walk') {
    eulerWalk.set(walkState.pitch, walkState.yaw, 0, 'YXZ');
    camera.quaternion.setFromEuler(eulerWalk);

    const isSprint =
      walkState.keys.has('ShiftLeft') ||
      walkState.keys.has('ShiftRight') ||
      walkState.mobileSprint;
    const speed = isSprint ? 7.8 : 4.2;

    tmpFwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    tmpFwd.y = 0;
    tmpFwd.normalize();
    tmpRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tmpRight.y = 0;
    tmpRight.normalize();

    let inputFwd = walkState.joyY;
    let inputRight = walkState.joyX;
    if (walkState.keys.has('KeyW') || walkState.keys.has('ArrowUp')) inputFwd += 1;
    if (walkState.keys.has('KeyS') || walkState.keys.has('ArrowDown')) inputFwd -= 1;
    if (walkState.keys.has('KeyD') || walkState.keys.has('ArrowRight')) inputRight += 1;
    if (walkState.keys.has('KeyA') || walkState.keys.has('ArrowLeft')) inputRight -= 1;

    tmpMove.set(0, 0, 0);
    const inputLen = Math.hypot(inputFwd, inputRight);
    if (inputLen > 0.05) {
      const scale = Math.min(1, inputLen) / inputLen;
      tmpMove
        .addScaledVector(tmpFwd, inputFwd * scale * speed * dt)
        .addScaledVector(tmpRight, inputRight * scale * speed * dt);

      // Dismiss walkthrough hint quickly once the user starts walking
      walkState.movedTime += dt;
      if (walkState.movedTime > 1.6) dismissWalkHint();
    }

    if (walkPhysics) {
      walkPhysics.update(dt, tmpMove, camera, onPhysicsEvent);
    } else {
      camera.position.add(tmpMove);
    }
  }

  if (useBloom) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

loadSceneAssets();
animate();
