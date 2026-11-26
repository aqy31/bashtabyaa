import * as THREE from 'three';

const EYE_HEIGHT = 1.68;
const STEP_HEIGHT = 0.72;     // Smoothly climbs stone stairs & ledges
const PLAYER_RADIUS = 0.48;   // Physical body width against walls
const GRAVITY = -18.5;        // Realistic gravity (m/s^2)
const JUMP_SPEED = 6.6;
const RIVER_WATER_Y = -4.7;   // Tigris River level (-5.2m) + splash margin

/**
 * Fast, physical First-Person character controller with:
 * - Ground & stair detection via bounding-box-accelerated raycasting
 * - Smooth wall collision & sliding + tactile bump impulse
 * - Real gravity falling off towers/walls + landing impact camera dip
 * - Automatic respawn if falling into the Tigris River
 */
export class WalkPhysics {
  constructor(rootScene, spawnPos) {
    this.colliders = [];
    this.spawnPos = new THREE.Vector3(...spawnPos);

    this.feetPos = new THREE.Vector3(spawnPos[0], spawnPos[1] - EYE_HEIGHT, spawnPos[2]);
    this.velY = 0;
    this.grounded = false;

    // Tactile feedback states ("يحس بالارض والجدران")
    this.landingDip = 0;       // Vertical camera dip on landing
    this.landingDipVel = 0;
    this.bumpOffset = new THREE.Vector3(); // Subtle horizontal recoil when bumping a wall
    this.bobTime = 0;
    this.bumpCooldown = 0;

    // Reusable math objects (zero per-frame GC!)
    this._raycaster = new THREE.Raycaster();
    this._down = new THREE.Vector3(0, -1, 0);
    this._rayOrigin = new THREE.Vector3();
    this._rayDir = new THREE.Vector3();
    this._tmpBoxHit = new THREE.Vector3();
    this._normMatrix = new THREE.Matrix3();
    this._worldNormal = new THREE.Vector3();

    this._collectColliders(rootScene);
  }

  _collectColliders(root) {
    if (!root) return;
    root.updateMatrixWorld(true);

    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const n = obj.name || '';
      // Exclude non-solid decorative / effect meshes
      if (
        n.endsWith('_Flame') ||
        n.endsWith('_Sparks') ||
        n === 'Tigris_River_Plane' ||
        n === 'Tigris_FarBank_Trees' ||
        n === 'Mosul_Wet_Grass_Tufts' ||
        n.startsWith('Mosul_Bird_') ||
        n.startsWith('Bird_Nest_')
      ) {
        return;
      }
      obj.geometry.computeBoundingBox();
      const worldBox = new THREE.Box3().copy(obj.geometry.boundingBox).applyMatrix4(obj.matrixWorld);
      this.colliders.push({ mesh: obj, box: worldBox });
    });
  }

  /** Fast raycast against only meshes whose world Box3 intersects the ray */
  _castRay(origin, dir, maxDist) {
    this._raycaster.set(origin, dir);
    this._raycaster.near = 0.01;
    this._raycaster.far = maxDist;
    const ray = this._raycaster.ray;

    let closest = null;
    for (let i = 0; i < this.colliders.length; i++) {
      const c = this.colliders[i];
      if (!ray.intersectBox(c.box, this._tmpBoxHit)) continue;
      if (origin.distanceToSquared(this._tmpBoxHit) > maxDist * maxDist + 4.0) continue;

      const hits = this._raycaster.intersectObject(c.mesh, false);
      if (hits.length > 0) {
        if (!closest || hits[0].distance < closest.distance) {
          closest = hits[0];
        }
      }
    }
    return closest;
  }

  /** Sample ground height under feet (center + 4 small offsets for stable stair edges) */
  _findGroundY(x, feetY, z) {
    const startY = feetY + STEP_HEIGHT;
    const maxDrop = 120.0;
    const offsets = [
      [0, 0],
      [0.24, 0],
      [-0.24, 0],
      [0, 0.24],
      [0, -0.24],
    ];

    let bestY = -Infinity;
    for (let i = 0; i < offsets.length; i++) {
      this._rayOrigin.set(x + offsets[i][0], startY, z + offsets[i][1]);
      const hit = this._castRay(this._rayOrigin, this._down, maxDrop);
      if (hit && hit.point.y > bestY) {
        // Check surface isn't a sheer vertical wall (normal.y > 0.45)
        if (hit.face) {
          this._normMatrix.getNormalMatrix(hit.object.matrixWorld);
          this._worldNormal.copy(hit.face.normal).applyMatrix3(this._normMatrix).normalize();
          if (this._worldNormal.y < 0.45) continue;
        }
        bestY = hit.point.y;
      }
    }
    return bestY;
  }

  /** Teleport player safely onto the ground at target eye position */
  teleportToEye(eyePos) {
    this.feetPos.set(eyePos.x, eyePos.y - EYE_HEIGHT, eyePos.z);
    const groundY = this._findGroundY(this.feetPos.x, this.feetPos.y + 1.2, this.feetPos.z);
    if (groundY > -50) {
      this.feetPos.y = groundY;
      this.grounded = true;
    } else {
      this.grounded = false;
    }
    this.velY = 0;
    this.landingDip = 0;
    this.landingDipVel = 0;
    this.bumpOffset.set(0, 0, 0);
  }

  jump() {
    if (this.grounded) {
      this.velY = JUMP_SPEED;
      this.grounded = false;
    }
  }

  /**
   * Step physics forward by dt seconds.
   * @param {number} dt
   * @param {THREE.Vector3} moveVec Desired horizontal displacement (dx, 0, dz)
   * @param {THREE.Camera} camera Camera to position with eye height + physical feel
   * @param {Function} onEvent Optional callback: ('wall_bump' | 'hard_land' | 'river_fall', intensity)
   */
  update(dt, moveVec, camera, onEvent) {
    this.bumpCooldown = Math.max(0, this.bumpCooldown - dt);

    // 1. HORIZONTAL MOVEMENT WITH WALL COLLISION & SLIDING
    const moveLen = moveVec.length();
    let actuallyMoved = 0;

    if (moveLen > 1e-5) {
      const remaining = moveVec.clone();

      // Up to 2 slide iterations so corners behave cleanly
      for (let iter = 0; iter < 2; iter++) {
        const len = remaining.length();
        if (len < 1e-5) break;

        this._rayDir.copy(remaining).normalize();
        const checkDist = len + PLAYER_RADIUS;

        // Check at waist and chest height so low parapets & walls both block cleanly
        const heights = [0.78, 1.38];
        let wallHit = null;
        for (let h = 0; h < heights.length; h++) {
          this._rayOrigin.set(this.feetPos.x, this.feetPos.y + heights[h], this.feetPos.z);
          const hit = this._castRay(this._rayOrigin, this._rayDir, checkDist);
          if (hit && (!wallHit || hit.distance < wallHit.distance)) {
            wallHit = hit;
          }
        }

        if (wallHit && wallHit.face) {
          this._normMatrix.getNormalMatrix(wallHit.object.matrixWorld);
          this._worldNormal.copy(wallHit.face.normal).applyMatrix3(this._normMatrix).normalize();
          this._worldNormal.y = 0;
          if (this._worldNormal.lengthSq() > 1e-4) {
            this._worldNormal.normalize();
          }

          // Advance up to safe buffer from wall
          const safeDist = Math.max(0, wallHit.distance - PLAYER_RADIUS - 0.02);
          this.feetPos.addScaledVector(this._rayDir, safeDist);
          actuallyMoved += safeDist;

          // Tactile wall bump feel if walking head-on into stone wall
          const impactDot = -this._rayDir.dot(this._worldNormal);
          if (impactDot > 0.45 && this.bumpCooldown <= 0) {
            this.bumpOffset.addScaledVector(this._worldNormal, 0.065 * impactDot);
            this.bumpCooldown = 0.28;
            onEvent?.('wall_bump', impactDot);
          }

          // Project remaining motion along wall tangent for smooth sliding
          const intoWall = remaining.dot(this._worldNormal);
          if (intoWall < 0) {
            remaining.addScaledVector(this._worldNormal, -intoWall);
          }
          // Shrink remaining by what we already moved
          remaining.multiplyScalar(Math.max(0, 1 - safeDist / len));
        } else {
          this.feetPos.add(remaining);
          actuallyMoved += len;
          break;
        }
      }
    }

    // 2. GRAVITY, GROUND FOLLOWING & REAL FALLING
    const groundY = this._findGroundY(this.feetPos.x, this.feetPos.y, this.feetPos.z);

    if (this.grounded) {
      if (groundY > -50 && groundY >= this.feetPos.y - 0.48 && groundY <= this.feetPos.y + STEP_HEIGHT) {
        // Smoothly follow slopes & stone stairs!
        const targetY = groundY;
        this.feetPos.y += (targetY - this.feetPos.y) * Math.min(1, dt * 18);
        this.velY = 0;
      } else {
        // Walked off a ledge / bastion tower / curtain wall -> START FALLING!
        this.grounded = false;
      }
    }

    if (!this.grounded) {
      this.velY += GRAVITY * dt;
      this.velY = Math.max(this.velY, -34.0); // terminal velocity
      this.feetPos.y += this.velY * dt;

      if (groundY > -50 && this.feetPos.y <= groundY) {
        const impactSpeed = Math.abs(this.velY);
        this.feetPos.y = groundY;
        this.velY = 0;
        this.grounded = true;

        // Physical landing dip & thud proportional to fall height!
        if (impactSpeed > 3.2) {
          const dip = Math.min(0.55, (impactSpeed - 2.5) * 0.036);
          this.landingDipVel -= dip * 14.0;
          onEvent?.('hard_land', Math.min(1, impactSpeed / 16.0));
        }
      }
    }

    // 3. TIGRIS RIVER SPLASH / OUT-OF-BOUNDS RESPAWN
    if (this.feetPos.y < RIVER_WATER_Y) {
      onEvent?.('river_fall', 1.0);
      this.teleportToEye(this.spawnPos);
    }

    // 4. SPRING-DAMPED PHYSICAL CAMERA FEEL (Footsteps + Landing Dip + Wall Bump)
    // Spring return for landing dip
    const springK = 85.0;
    const damping = 13.0;
    this.landingDipVel += (-springK * this.landingDip - damping * this.landingDipVel) * dt;
    this.landingDip += this.landingDipVel * dt;
    this.landingDip = Math.max(-0.55, Math.min(0.15, this.landingDip));

    // Smooth decay of wall bump recoil
    this.bumpOffset.multiplyScalar(Math.exp(-14.0 * dt));

    // Grounded footsteps bobbing
    let bobY = 0;
    let bobX = 0;
    if (this.grounded && actuallyMoved > 0.005) {
      const stride = Math.min(2.2, actuallyMoved / Math.max(dt, 0.001) / 4.2);
      this.bobTime += dt * (7.2 * stride);
      bobY = Math.sin(this.bobTime * 2.0) * 0.042;
      bobX = Math.cos(this.bobTime) * 0.022;
    }

    // Apply final physical camera position
    camera.position.set(
      this.feetPos.x + this.bumpOffset.x + bobX,
      this.feetPos.y + EYE_HEIGHT + this.landingDip + bobY,
      this.feetPos.z + this.bumpOffset.z
    );
  }
}
