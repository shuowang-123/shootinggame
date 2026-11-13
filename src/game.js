// 银河小战士 —— 原创 3D 星际射击游戏
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import { initAudio, sfx, startMusic, stopMusic, setIntense, isMuted, setMuted, suspendAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- 渲染器
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  $('menu').classList.add('hidden'); $('err').classList.remove('hidden');
  throw e;
}
const scene = new THREE.Scene();
const FOG = new THREE.Color(0x2a0a55);
scene.background = new THREE.Color(0x05010f);
scene.fog = new THREE.Fog(FOG, 70, 260);
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 700);
const CAM_DIST = 11;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.9);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const field = { x: 8, y: 4, yc: 5.2 };
let unitsPerPx = 0.02, viewW = 1, viewH = 1;
const forcedQ = params.has('q') ? clamp(parseInt(params.get('q'), 10) || 0, 0, 2) : -1;
let quality = forcedQ >= 0 ? forcedQ : 2;

function resize() {
  viewW = window.innerWidth; viewH = window.innerHeight;
  const aspect = viewW / viewH;
  camera.aspect = aspect;
  camera.fov = aspect < 1 ? 72 : 58;
  camera.updateProjectionMatrix();
  const halfH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CAM_DIST;
  field.x = clamp(halfH * aspect * 1.5, 4.5, 12);
  field.y = clamp(halfH * 0.72, 3, 5.5);
  field.yc = field.y + 1.4;
  unitsPerPx = (2 * halfH) / viewH;
  const dpr = window.devicePixelRatio || 1;
  const pr = quality === 2 ? Math.min(dpr, 2) : quality === 1 ? Math.min(dpr, 1.25) : 1;
  renderer.setPixelRatio(pr);
  renderer.setSize(viewW, viewH, false);
  composer.setPixelRatio(pr);
  composer.setSize(viewW, viewH);
  if (particleMat) particleMat.uniforms.uScale.value = (viewH * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// ---------------------------------------------------------------- 灯光与天空
scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x5a2a88, 1.5));
const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
sunLight.position.set(4, 10, 8);
scene.add(sunLight);

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(600, 24, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uFog: { value: FOG } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uFog; varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uFog, vec3(0.012, 0.004, 0.05), pow(h, 0.45));
        float s = max(dot(d, normalize(vec3(0.0, 0.07, -1.0))), 0.0);
        col += vec3(1.0, 0.35, 0.55) * pow(s, 24.0) * 0.3;
        col += vec3(0.25, 0.3, 0.9) * pow(max(dot(d, normalize(vec3(-0.5, 0.4, -1.0))), 0.0), 10.0) * 0.25;
        if (d.y < 0.0) col = uFog;
        gl_FragColor = vec4(col, 1.0);
      }`,
  }),
);
sky.renderOrder = -10;
scene.add(sky);

// 远处的条纹太阳
const sun = new THREE.Mesh(
  new THREE.CircleGeometry(70, 48),
  new THREE.ShaderMaterial({
    fog: false, transparent: true, depthWrite: false,
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform float uT; varying vec2 vUv;
      void main(){
        float y = vUv.y;
        vec3 col = mix(vec3(0.8, 0.1, 0.5), vec3(0.95, 0.62, 0.15), smoothstep(0.15, 0.95, y));
        float stripe = step(0.5, fract(y * 14.0 - uT * 0.25));
        float cut = mix(1.0, stripe, smoothstep(0.62, 0.15, y));
        float edge = smoothstep(0.5, 0.485, distance(vUv, vec2(0.5)));
        gl_FragColor = vec4(col, cut * edge);
      }`,
  }),
);
sun.position.set(0, 42, -520);
sun.renderOrder = -9;
scene.add(sun);

// 带光环的大行星
const planet = new THREE.Group();
planet.add(new THREE.Mesh(new THREE.SphereGeometry(34, 32, 24),
  new THREE.MeshStandardMaterial({ color: 0x3a6bff, emissive: 0x150a50, roughness: 0.8, fog: false })));
const pring = new THREE.Mesh(new THREE.RingGeometry(46, 66, 64),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.5, 1.2), side: THREE.DoubleSide, transparent: true, opacity: 0.55, fog: false, depthWrite: false }));
pring.rotation.x = Math.PI / 2.25; pring.rotation.y = 0.3;
planet.add(pring);
planet.position.set(-190, 150, -480);
scene.add(planet);

// 星星
const STAR_N = 900;
const starGeo = new THREE.BufferGeometry();
const starPos = new Float32Array(STAR_N * 3);
for (let i = 0; i < STAR_N; i++) {
  starPos[i * 3] = rand(-260, 260); starPos[i * 3 + 1] = rand(8, 200); starPos[i * 3 + 2] = rand(-420, -120);
}
starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xcfe4ff, size: 1.6 * Math.min(window.devicePixelRatio || 1, 2), sizeAttenuation: false, fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
stars.frustumCulled = false;
scene.add(stars);

// 霓虹网格地面
const WORLD_SPEED = 62;
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uOff: { value: 0 }, uFog: { value: FOG }, uPulse: { value: 0 } },
  vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
  fragmentShader: `
    uniform float uOff; uniform float uPulse; uniform vec3 uFog; varying vec3 vW;
    void main(){
      vec2 p = vec2(vW.x, vW.z - uOff) / 5.0;
      vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      float d = length(vW.xz - cameraPosition.xz);
      float fade = exp(-d * 0.011);
      vec3 lc = mix(vec3(0.1, 0.95, 1.7), vec3(1.7, 0.2, 1.3), smoothstep(15.0, 110.0, d));
      float wave = 0.5 + 0.5 * sin((vW.z - uOff) * 0.08);
      vec3 col = vec3(0.02, 0.0, 0.07) + lc * line * (0.75 + uPulse) + lc * 0.05 * wave;
      gl_FragColor = vec4(mix(uFog, col, fade), 1.0);
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 700), floorMat);
floor.rotation.x = -Math.PI / 2; floor.position.z = -300;
scene.add(floor);

// 两侧飞驰而过的光塔和头顶的光环门
const PYL_N = 36;
const pylGeo = new THREE.BoxGeometry(1, 1, 1);
const pylons = new THREE.InstancedMesh(pylGeo, new THREE.MeshStandardMaterial({ color: 0x1a1140, roughness: 0.5, metalness: 0.4 }), PYL_N);
const pylTops = new THREE.InstancedMesh(pylGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 1.6, 2.2) }), PYL_N);
pylons.frustumCulled = pylTops.frustumCulled = false;
const pylData = [];
for (let i = 0; i < PYL_N; i++) {
  const side = i % 2 ? 1 : -1;
  pylData.push({ x: side * rand(24, 70), z: -i * 9 + 10, h: rand(6, 26), w: rand(1.5, 3.5) });
  pylTops.setColorAt(i, new THREE.Color().setHSL(pick([0.52, 0.85, 0.12]), 1, 0.5).multiplyScalar(2.2));
}
scene.add(pylons, pylTops);
const gates = [];
for (let i = 0; i < 4; i++) {
  const col = i % 2 ? new THREE.Color(2.0, 0.3, 1.4) : new THREE.Color(0.3, 1.5, 2.2);
  const g = new THREE.Mesh(new THREE.TorusGeometry(24, 0.35, 6, 40, Math.PI), new THREE.MeshBasicMaterial({ color: col }));
  g.position.z = -i * 80 - 40;
  gates.push(g); scene.add(g);
}

// ---------------------------------------------------------------- 粒子系统
const PN = 2600;
const pPos = new Float32Array(PN * 3), pCol = new Float32Array(PN * 4), pSize = new Float32Array(PN);
const pVel = new Float32Array(PN * 3), pLife = new Float32Array(PN), pMax = new Float32Array(PN);
const pDrag = new Float32Array(PN), pGrav = new Float32Array(PN), pBase = new Float32Array(PN);
let pIdx = 0;
const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
particleGeo.setAttribute('aColor', new THREE.BufferAttribute(pCol, 4).setUsage(THREE.DynamicDrawUsage));
particleGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
const particleMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 400 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  vertexShader: `
    attribute vec4 aColor; attribute float aSize; uniform float uScale; varying vec4 vC;
    void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = min(aSize * uScale / max(-mv.z, 0.5), 420.0); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `
    varying vec4 vC;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); a = a * a * vC.a;
      gl_FragColor = vec4(vC.rgb, a); }`,
});
const particles = new THREE.Points(particleGeo, particleMat);
particles.frustumCulled = false; particles.renderOrder = 5;
scene.add(particles);

function spark(x, y, z, vx, vy, vz, r, g, b, size, life, drag = 1.5, grav = 0) {
  const i = pIdx; pIdx = (pIdx + 1) % PN;
  pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z;
  pVel[i * 3] = vx; pVel[i * 3 + 1] = vy; pVel[i * 3 + 2] = vz;
  pCol[i * 4] = r; pCol[i * 4 + 1] = g; pCol[i * 4 + 2] = b; pCol[i * 4 + 3] = 1;
  pBase[i] = size; pSize[i] = size; pLife[i] = life; pMax[i] = life; pDrag[i] = drag; pGrav[i] = grav;
}
function updateParticles(dt) {
  for (let i = 0; i < PN; i++) {
    if (pLife[i] <= 0) continue;
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pSize[i] = 0; continue; }
    const k = pLife[i] / pMax[i], f = Math.max(0, 1 - pDrag[i] * dt), j = i * 3;
    pVel[j] *= f; pVel[j + 1] = pVel[j + 1] * f - pGrav[i] * dt; pVel[j + 2] *= f;
    pPos[j] += pVel[j] * dt; pPos[j + 1] += pVel[j + 1] * dt; pPos[j + 2] += pVel[j + 2] * dt;
    if (pPos[j + 1] < 0.1 && pGrav[i] > 0) { pPos[j + 1] = 0.1; pVel[j + 1] *= -0.5; }
    pCol[i * 4 + 3] = k; pSize[i] = pBase[i] * (0.35 + 0.65 * k);
  }
  particleGeo.attributes.position.needsUpdate = true;
  particleGeo.attributes.aColor.needsUpdate = true;
  particleGeo.attributes.aSize.needsUpdate = true;
}

// 冲击波光环
const rings = [];
const ringGeo = new THREE.RingGeometry(0.86, 1, 48);
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.visible = false; m.renderOrder = 4; scene.add(m);
  rings.push({ m, t: 0, life: 0, s0: 1, s1: 1 });
}
let ringIdx = 0;
function shockwave(x, y, z, color, s1, life = 0.45, flat = false) {
  const r = rings[ringIdx]; ringIdx = (ringIdx + 1) % rings.length;
  r.m.position.set(x, y, z); r.m.material.color.copy(color); r.m.visible = true;
  r.t = 0; r.life = life; r.s0 = s1 * 0.1; r.s1 = s1; r.flat = flat;
}
function updateRings(dt) {
  for (const r of rings) {
    if (!r.m.visible) continue;
    r.t += dt; const k = r.t / r.life;
    if (k >= 1) { r.m.visible = false; continue; }
    const e = 1 - (1 - k) * (1 - k);
    r.m.scale.setScalar(r.s0 + (r.s1 - r.s0) * e);
    r.m.material.opacity = (1 - k) * 0.9;
    if (r.flat) r.m.rotation.set(-Math.PI / 2, 0, 0); else r.m.quaternion.copy(camera.quaternion);
  }
}

const C = {
  cyan: new THREE.Color(0.2, 1.1, 1.7), pink: new THREE.Color(1.7, 0.25, 0.9), gold: new THREE.Color(1.7, 1.05, 0.2),
  red: new THREE.Color(1.8, 0.2, 0.18), green: new THREE.Color(0.3, 1.6, 0.45), white: new THREE.Color(1.4, 1.4, 1.4),
  purple: new THREE.Color(0.95, 0.35, 1.7), orange: new THREE.Color(1.7, 0.65, 0.15),
};

let trauma = 0;
function shake(a) { trauma = Math.min(1, trauma + a); }

function explode(x, y, z, color, scale = 1, quiet = false) {
  const n = Math.round(26 * Math.min(scale, 3)) + 8;
  for (let i = 0; i < n; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
    const sp = rand(6, 26) * (0.7 + scale * 0.45);
    const w = Math.random() < 0.3;
    spark(x, y, z, s * Math.cos(th) * sp, u * sp, s * Math.sin(th) * sp + 12,
      w ? 1.6 : color.r, w ? 1.5 : color.g, w ? 1.2 : color.b, rand(0.35, 0.9) * (0.8 + scale * 0.3), rand(0.35, 0.9), 2.2, 10);
  }
  for (let i = 0; i < 6 + scale * 3; i++) {
    spark(x + rand(-1, 1) * scale, y + rand(-1, 1) * scale, z + rand(-1, 1) * scale, rand(-3, 3), rand(0, 4), rand(4, 12),
      color.r * 0.6, color.g * 0.6, color.b * 0.6, rand(2.2, 4) * scale, rand(0.3, 0.6), 1, 0);
  }
  spark(x, y, z, 0, 0, 10, 1.1, 1.0, 0.9, 5 * scale, 0.12, 0, 0);
  shockwave(x, y, z, color, 5 * scale);
  shake(0.18 + 0.12 * scale);
  if (!quiet) sfx.boom(scale);
}

// ---------------------------------------------------------------- 模型零件
const G = {
  sphere: new THREE.SphereGeometry(1, 18, 12), box: new THREE.BoxGeometry(1, 1, 1), cone: new THREE.ConeGeometry(1, 1, 10),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 12), torus: new THREE.TorusGeometry(1, 0.1, 8, 28), oct: new THREE.OctahedronGeometry(1),
  ico: new THREE.IcosahedronGeometry(1, 0),
};
const glowMat = {};
for (const k in C) glowMat[k] = new THREE.MeshBasicMaterial({ color: C[k] });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x23233a, roughness: 0.45, metalness: 0.6 });
const std = (color, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.38, metalness: 0.35 });

function part(parent, geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m);
  return m;
}

// ---------------------------------------------------------------- 玩家飞船
const ship = new THREE.Group();
const shipBody = new THREE.Group();
ship.add(shipBody);
{
  const hull = std(0xe9f2ff), blue = std(0x1f6bff), red = std(0xff3355);
  const nose = part(shipBody, G.cone, hull, 0.5, 2.4, 0.42, 0, 0, -0.9); nose.rotation.x = -Math.PI / 2;
  part(shipBody, G.box, hull, 0.9, 0.42, 1.5, 0, 0, 0.55);
  part(shipBody, G.sphere, glowMat.cyan, 0.3, 0.24, 0.6, 0, 0.28, -0.1);
  for (const s of [-1, 1]) {
    const wing = part(shipBody, G.box, blue, 1.7, 0.09, 0.95, s * 1.15, -0.05, 0.75); wing.rotation.y = s * -0.35; wing.rotation.z = s * 0.08;
    part(shipBody, G.box, red, 0.12, 0.5, 0.8, s * 1.95, 0.15, 1.0);
    const gun = part(shipBody, G.cyl, darkMat, 0.09, 1.3, 0.09, s * 1.25, -0.1, 0.0); gun.rotation.x = Math.PI / 2;
    part(shipBody, G.sphere, glowMat.gold, 0.11, 0.11, 0.11, s * 1.25, -0.1, -0.68);
    const eng = part(shipBody, G.cyl, darkMat, 0.26, 0.7, 0.26, s * 0.42, 0, 1.35); eng.rotation.x = Math.PI / 2;
    part(shipBody, G.sphere, glowMat.cyan, 0.16, 0.16, 0.1, s * 0.42, 0, 1.72);
  }
  const fin = part(shipBody, G.box, red, 0.08, 0.6, 0.8, 0, 0.45, 1.0); fin.rotation.x = 0.35;
}
const flames = [];
for (const s of [-1, 1]) {
  const f = part(shipBody, G.cone, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.5, 3), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }), 0.15, 1.0, 0.15, s * 0.42, 0, 2.2);
  f.rotation.x = Math.PI / 2; flames.push(f);
}
const shieldMesh = part(ship, G.sphere, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.8), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }), 2.2, 1.2, 2.3, 0, 0, 0.3);
shieldMesh.visible = false;
scene.add(ship);

const reticle = new THREE.Group();
{
  const m = new THREE.MeshBasicMaterial({ color: C.gold, depthTest: false, transparent: true, fog: false });
  const r1 = new THREE.Mesh(new THREE.RingGeometry(1.0, 1.12, 4, 1), m); reticle.add(r1);
  const r2 = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.7, 32, 1, 0, Math.PI * 1.5), m); reticle.add(r2);
  reticle.userData = { r1, r2 };
}
reticle.visible = false; reticle.renderOrder = 6;
scene.add(reticle);

// ---------------------------------------------------------------- 子弹（实例化渲染）
const PB_MAX = 220, EB_MAX = 200;
const pbGeo = new THREE.CylinderGeometry(0.1, 0.1, 2.4, 6); pbGeo.rotateX(Math.PI / 2);
const pbMesh = new THREE.InstancedMesh(pbGeo, new THREE.MeshBasicMaterial({ color: C.cyan, fog: false }), PB_MAX);
const ebMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 12, 8), new THREE.MeshBasicMaterial({ color: C.pink, fog: false }), EB_MAX);
pbMesh.frustumCulled = ebMesh.frustumCulled = false; pbMesh.count = ebMesh.count = 0;
scene.add(pbMesh, ebMesh);
const pBullets = [], eBullets = [];
const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
const FWD = new THREE.Vector3(0, 0, -1);
const LEVEL_COL = [C.cyan, C.cyan, C.green, C.gold, C.pink];

// ---------------------------------------------------------------- 游戏状态
let state = 'menu'; // menu | play | pause | over
let score = 0, best = 0, wave = 0, combo = 0, comboT = 0, time = 0, timeScale = 1, slowT = 0;
try { best = parseInt(localStorage.getItem('gw_best') || '0', 10) || 0; } catch (e) { /* ignore */ }
const P = { x: 0, y: 5, tx: 0, ty: 5, lives: 3, shield: false, inv: 0, level: 1, bombs: 2, fireT: 0, alive: true, deadT: 0 };
const enemies = [], pickups = [], spawnQ = [];
let waveT = 0, waveState = 'idle', boss = null, target = null;

// ---------------------------------------------------------------- 敌人
const TYPES = {
  drone: { hp: 4, r: 2.1, score: 100, col: C.purple },
  bot: { hp: 9, r: 2.4, score: 200, col: C.orange },
  spike: { hp: 5, r: 1.9, score: 150, col: C.red },
  tank: { hp: 30, r: 3.5, score: 500, col: C.green },
  boss: { hp: 480, r: 7, score: 5000, col: C.pink },
};

function buildEnemy(type) {
  const g = new THREE.Group();
  let mat;
  const spin = [];
  if (type === 'drone') {
    mat = std(0x8a4dff);
    part(g, G.sphere, mat, 1.6, 0.45, 1.6);
    part(g, G.sphere, glowMat.green, 0.75, 0.6, 0.75, 0, 0.32, 0);
    const t = part(g, G.torus, glowMat.pink, 1.75, 1.75, 1.2); t.rotation.x = Math.PI / 2; spin.push([t, 'z', 3]);
    part(g, G.sphere, glowMat.gold, 0.22, 0.22, 0.22, 0, -0.1, 1.5);
    part(g, G.cone, darkMat, 0.5, 0.5, 0.5, 0, -0.55, 0).rotation.x = Math.PI;
  } else if (type === 'bot') {
    mat = std(0xff8a1f);
    part(g, G.box, mat, 1.7, 1.7, 1.2, 0, -0.2, 0);
    part(g, G.box, mat, 1.15, 0.9, 1.0, 0, 1.15, 0);
    part(g, G.box, glowMat.red, 0.9, 0.24, 0.2, 0, 1.2, 0.5);
    part(g, G.box, glowMat.cyan, 0.7, 0.5, 0.15, 0, -0.1, 0.6);
    part(g, G.cyl, darkMat, 0.05, 0.6, 0.05, 0, 1.9, 0);
    part(g, G.sphere, glowMat.gold, 0.16, 0.16, 0.16, 0, 2.25, 0);
    for (const s of [-1, 1]) {
      part(g, G.sphere, darkMat, 0.42, 0.42, 0.42, s * 1.2, 0.3, 0);
      const arm = part(g, G.cyl, darkMat, 0.28, 1.4, 0.28, s * 1.35, 0.1, 0.6); arm.rotation.x = Math.PI / 2;
      part(g, G.sphere, glowMat.pink, 0.24, 0.24, 0.24, s * 1.35, 0.1, 1.3);
      const fl = part(g, G.cone, glowMat.cyan, 0.3, 0.9, 0.3, s * 0.5, -1.5, 0); fl.rotation.x = Math.PI;
    }
  } else if (type === 'spike') {
    mat = std(0xff3344);
    const core = new THREE.Group(); g.add(core);
    part(core, G.oct, mat, 1.1, 1.1, 1.9);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const c = part(core, G.cone, darkMat, 0.3, 1.5, 0.3, Math.cos(a) * 1.25, Math.sin(a) * 1.25, 0); c.rotation.z = a - Math.PI / 2;
    }
    part(g, G.sphere, glowMat.gold, 0.4, 0.4, 0.4, 0, 0, 1.55);
    spin.push([core, 'z', 5]);
  } else if (type === 'tank') {
    mat = std(0x2fd36b);
    part(g, G.ico, mat, 2.5, 2.5, 2.5);
    part(g, G.sphere, glowMat.gold, 1.05, 1.05, 0.6, 0, 0.15, 2.05);
    part(g, G.sphere, darkMat, 0.45, 0.45, 0.3, 0, 0.15, 2.55);
    for (const s of [-1, 1]) {
      const h = part(g, G.cone, darkMat, 0.5, 1.9, 0.5, s * 1.9, 2.1, 0); h.rotation.z = s * -0.6;
      const c = part(g, G.cyl, darkMat, 0.4, 1.6, 0.4, s * 2.6, -0.6, 0.9); c.rotation.x = Math.PI / 2;
      part(g, G.sphere, glowMat.pink, 0.34, 0.34, 0.34, s * 2.6, -0.6, 1.75);
    }
    const t = part(g, G.torus, glowMat.green, 3.3, 3.3, 2); spin.push([t, 'z', 1.5]);
  } else {
    mat = std(0x3b4a8c, 0x05061a);
    part(g, G.box, mat, 8, 5.4, 5, 0, 0, 0);
    part(g, G.box, darkMat, 9, 1.2, 5.4, 0, 2.2, 0);
    const jaw = part(g, G.box, darkMat, 6, 1.3, 4.6, 0, -3.1, 0.4); g.userData.jaw = jaw;
    for (let i = -2; i <= 2; i++) part(g, G.cone, glowMat.white, 0.3, 0.8, 0.3, i * 1.1, -2.2, 2.5).rotation.x = Math.PI;
    for (const s of [-1, 1]) {
      const eye = part(g, G.sphere, glowMat.red, 1.05, 0.8, 0.5, s * 2.1, 0.7, 2.5); eye.rotation.z = s * 0.35;
      part(g, G.sphere, darkMat, 0.35, 0.35, 0.3, s * 2.0, 0.6, 2.9);
      const horn = part(g, G.cone, glowMat.gold, 0.7, 3.2, 0.7, s * 3.4, 4.2, 0); horn.rotation.z = s * -0.45;
      const can = part(g, G.cyl, darkMat, 0.9, 4, 0.9, s * 5.6, -0.6, 0.8); can.rotation.x = Math.PI / 2;
      part(g, G.sphere, glowMat.pink, 0.75, 0.75, 0.75, s * 5.6, -0.6, 2.8);
      part(g, G.box, mat, 1.6, 1.2, 2.4, s * 4.4, -0.6, 0);
    }
    part(g, G.cone, glowMat.cyan, 0.5, 2.2, 0.5, 0, 4.0, 0);
    const halo = part(g, G.torus, glowMat.purple, 8.5, 8.5, 3); spin.push([halo, 'z', 0.8]);
    const halo2 = part(g, G.torus, glowMat.cyan, 7, 7, 2, 0, 0, -1.5); spin.push([halo2, 'z', -1.3]);
  }
  g.userData.spin = spin;
  g.scale.setScalar(type === 'boss' ? 1.4 : 1.25);
  return { g, mat };
}

function spawnEnemy(type, opt = {}) {
  const T = TYPES[type];
  const { g, mat } = buildEnemy(type);
  const hpMul = type === 'boss' ? 1 + (wave / 5 - 1) * 0.6 : 1 + wave * 0.15;
  const e = {
    type, g, mat, r: T.r, hp: Math.ceil(T.hp * hpMul), maxHp: Math.ceil(T.hp * hpMul), score: T.score, col: T.col,
    x: opt.x ?? rand(-1, 1) * field.x, y: opt.y ?? field.yc + rand(-1, 1) * field.y * 0.85, z: opt.z ?? -150,
    bx: 0, by: 0, hz: type === 'boss' ? -42 : rand(-42, -24), t: rand(0, 6), fireT: rand(0.8, 2.2), flash: 0,
    ax: rand(1.5, 4), ay: rand(0.5, 1.6), fx: rand(0.5, 1.1), fy: rand(0.7, 1.4), mode: 'enter', mt: 0, vx: 0, vy: 0, vz: 0,
    pat: 0, burst: 0, burstT: 0, ang: 0, dying: 0,
  };
  e.bx = e.x; e.by = e.y;
  if (type === 'boss') { e.bx = 0; e.by = field.yc + 1; e.x = 0; e.y = field.yc + 14; e.fireT = 2.5; }
  g.position.set(e.x, e.y, e.z);
  scene.add(g); enemies.push(e);
  return e;
}

function removeEnemy(e) {
  scene.remove(e.g); e.mat.dispose();
  const i = enemies.indexOf(e); if (i >= 0) enemies.splice(i, 1);
  if (target === e) target = null;
}

function eShoot(ox, oy, oz, tx, ty, tz, speed) {
  if (eBullets.length >= EB_MAX) return;
  const dx = tx - ox, dy = ty - oy, dz = tz - oz, l = Math.hypot(dx, dy, dz) || 1;
  eBullets.push({ x: ox, y: oy, z: oz, vx: (dx / l) * speed, vy: (dy / l) * speed, vz: (dz / l) * speed, ph: Math.random() * 6 });
}
const bulletSpeed = () => Math.min(42, 25 + wave * 0.8);
const fireRate = () => Math.max(0.55, 1 - wave * 0.025);

function enemyFire(e) {
  const sp = bulletSpeed();
  if (e.type === 'drone') {
    eShoot(e.x, e.y, e.z + 1.5, P.x, P.y, 0, sp);
    e.fireT = rand(2.6, 4.5) * fireRate();
  } else if (e.type === 'bot') {
    for (const s of [-1, 1]) eShoot(e.x + s * 1.35, e.y, e.z + 1.5, P.x + s * 1.6, P.y, 0, sp);
    eShoot(e.x, e.y, e.z + 1.5, P.x, P.y, 0, sp * 1.1);
    e.fireT = rand(2.4, 3.6) * fireRate();
  } else if (e.type === 'tank') {
    const n = 8, R = 3.4, a0 = Math.random() * 6;
    for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; eShoot(e.x, e.y, e.z + 2.5, P.x + Math.cos(a) * R, P.y + Math.sin(a) * R, 0, sp * 0.85); }
    eShoot(e.x, e.y, e.z + 2.5, P.x, P.y, 0, sp);
    e.fireT = rand(2.6, 3.4) * fireRate();
  }
  spark(e.x, e.y, e.z + e.r, 0, 0, 20, C.pink.r, C.pink.g, C.pink.b, 3, 0.15, 0);
}

function bossLogic(e, dt) {
  e.bx = Math.sin(e.t * 0.45) * field.x * 0.55; e.by = field.yc + 1 + Math.sin(e.t * 0.8) * 1.4;
  const rage = e.hp < e.maxHp * 0.4;
  if (e.g.userData.jaw) e.g.userData.jaw.position.y = -3.1 - Math.abs(Math.sin(e.t * (rage ? 9 : 4))) * 0.5;
  if (e.burst > 0) {
    e.burstT -= dt;
    if (e.burstT <= 0) {
      e.burst--; e.burstT = 0.09; e.ang += 0.55;
      const R = 2.2 + (e.burst % 6) * 0.9;
      eShoot(e.x + (e.burst % 2 ? 7.8 : -7.8), e.y - 0.6, e.z + 3, Math.cos(e.ang) * R, field.yc + Math.sin(e.ang) * R * 0.8, 0, bulletSpeed() * 0.95);
    }
    return;
  }
  e.fireT -= dt;
  if (e.fireT > 0) return;
  const sp = bulletSpeed();
  const p = e.pat++ % 4;
  if (p === 0) {
    for (let i = -2; i <= 2; i++) eShoot(e.x, e.y - 1, e.z + 3, P.x + i * 2.4, P.y, 0, sp);
  } else if (p === 1) {
    const n = rage ? 14 : 10, R = 3.6, a0 = Math.random() * 6;
    for (let i = 0; i < n; i++) { const a = a0 + (i / n) * Math.PI * 2; eShoot(e.x, e.y, e.z + 3, P.x + Math.cos(a) * R, P.y + Math.sin(a) * R, 0, sp * 0.8); }
    for (let i = 0; i < 6; i++) { const a = a0 + (i / 6) * Math.PI * 2; eShoot(e.x, e.y, e.z + 3, P.x + Math.cos(a) * R * 2.2, P.y + Math.sin(a) * R * 2.2, 0, sp * 0.8); }
  } else if (p === 2) {
    e.burst = rage ? 26 : 18; e.burstT = 0;
    sfx.charge();
  } else {
    const minions = enemies.filter((m) => m !== e).length;
    for (let i = minions; i < Math.min(4, minions + 2); i++) spawnEnemy(rage ? 'spike' : 'drone', { x: e.x + rand(-4, 4), y: e.y - 1, z: e.z + 2 });
    eShoot(e.x, e.y - 1, e.z + 3, P.x, P.y, 0, sp * 1.15);
  }
  spark(e.x, e.y - 1, e.z + 4, 0, 0, 20, C.pink.r, C.pink.g, C.pink.b, 8, 0.2, 0);
  e.fireT = (rage ? 1.25 : 1.9) * fireRate();
}

function updateEnemies(dt) {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    e.t += dt; e.flash = Math.max(0, e.flash - dt * 6);
    e.mat.emissive.setScalar(e.flash * 0.9);
    for (const [m, ax, sp] of e.g.userData.spin) m.rotation[ax] += sp * dt;

    if (e.dying > 0) { // Boss 的连环爆炸
      e.dying -= dt;
      e.g.rotation.z += dt * 0.5; e.y -= dt * 1.5; e.g.position.y = e.y;
      e.mt -= dt;
      if (e.mt <= 0) { e.mt = 0.11; explode(e.x + rand(-5, 5), e.y + rand(-3, 3), e.z + rand(0, 4), pick([C.gold, C.pink, C.orange, C.white]), rand(1, 1.8)); }
      if (e.dying <= 0) finishBoss(e);
      continue;
    }

    if (e.mode === 'enter') {
      e.z += (e.hz - e.z) * Math.min(1, dt * 2.6) + 4 * dt;
      e.x += (e.bx - e.x) * Math.min(1, dt * 2); e.y += (e.by - e.y) * Math.min(1, dt * 2);
      if (e.z > e.hz - 1.5) { e.mode = 'hold'; e.mt = rand(1.4, 3.2); }
    } else if (e.mode === 'hold') {
      if (e.type === 'boss' && P.alive) bossLogic(e, dt);
      const tx = clamp(e.bx + Math.sin(e.t * e.fx) * e.ax, -field.x, field.x);
      const ty = clamp(e.by + Math.cos(e.t * e.fy) * e.ay, field.yc - field.y, field.yc + field.y + (e.type === 'boss' ? 3 : 0));
      e.x += (tx - e.x) * Math.min(1, dt * 3); e.y += (ty - e.y) * Math.min(1, dt * 3); e.z += (e.hz - e.z) * Math.min(1, dt * 2);
      if (e.type === 'spike') {
        e.mt -= dt;
        if (e.mt <= 0 && P.alive) { e.mode = 'aim'; e.mt = 0.75; sfx.charge(); }
      } else if (e.type !== 'boss' && P.alive) {
        e.fireT -= dt;
        if (e.fireT <= 0) enemyFire(e);
      }
    } else if (e.mode === 'aim') { // 冲锋前抖动预警
      e.mt -= dt; e.flash = 0.6 + 0.4 * Math.sin(e.t * 40);
      e.x += rand(-1, 1) * dt * 6; e.y += rand(-1, 1) * dt * 6; e.z -= dt * 6;
      if (e.mt <= 0) {
        const dx = P.x - e.x, dy = P.y - e.y, dz = -e.z, l = Math.hypot(dx, dy, dz), sp = 60 + Math.min(30, wave * 2);
        e.vx = (dx / l) * sp; e.vy = (dy / l) * sp; e.vz = (dz / l) * sp; e.mode = 'dash';
      }
    } else if (e.mode === 'dash') {
      e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
      spark(e.x, e.y, e.z, 0, 0, -5, C.red.r, C.red.g, C.red.b, 1.4, 0.3, 0);
      if (e.z > 14) { e.z = -150; e.bx = rand(-1, 1) * field.x; e.by = field.yc + rand(-1, 1) * field.y * 0.8; e.x = e.bx; e.y = e.by; e.mode = 'enter'; }
    }
    e.g.position.set(e.x, e.y, e.z);
    if (e.type !== 'boss') { e.g.rotation.z = Math.sin(e.t * 1.7) * 0.15; e.g.rotation.x = Math.sin(e.t * 1.3) * 0.08; }

    // 撞到玩家
    if (P.alive && Math.abs(e.z) < e.r + 0.8 && Math.hypot(e.x - P.x, e.y - P.y) < e.r + 0.5) {
      hurtPlayer();
      if (e.type !== 'boss') damageEnemy(e, 99);
    }
  }
}

function damageEnemy(e, dmg) {
  if (e.dying > 0 || e.hp <= 0) return;
  e.hp -= dmg; e.flash = 1;
  if (e === boss) $('bossFill').style.width = `${Math.max(0, (e.hp / e.maxHp) * 100)}%`;
  if (e.hp > 0) return;
  addScore(e.score, e.x, e.y, e.z);
  if (e.type === 'boss') {
    e.dying = 1.7; e.mt = 0; eBullets.length = 0; timeScale = 0.35; slowT = 1.2;
    for (const m of enemies.slice()) if (m !== e) damageEnemy(m, 999);
    return;
  }
  explode(e.x, e.y, e.z, e.col, e.type === 'tank' ? 1.8 : 1);
  const chance = e.type === 'tank' ? 0.6 : 0.11;
  if (Math.random() < chance) dropPickup(e.x, e.y, e.z);
  removeEnemy(e);
}

function finishBoss(e) {
  explode(e.x, e.y, e.z, C.gold, 3.2); explode(e.x, e.y, e.z, C.pink, 2.6, true);
  shockwave(e.x, e.y, e.z, C.white, 60, 0.9);
  flash('white'); shake(1); sfx.bomb(); sfx.win();
  for (let i = 0; i < 4; i++) dropPickup(e.x + rand(-4, 4), e.y + rand(-2, 2), e.z, ['P', 'H', 'B', 'S'][i]);
  removeEnemy(e); boss = null;
  $('bossBar').classList.remove('on'); setIntense(false);
  banner('胜利！', '机械魔王被打败了', false);
}

// ---------------------------------------------------------------- 宝石
const PICK = {
  P: { mat: glowMat.gold, col: C.gold, geo: G.oct, text: '火力升级！' },
  S: { mat: glowMat.cyan, col: C.cyan, geo: G.ico, text: '能量护盾！' },
  B: { mat: glowMat.orange, col: C.orange, geo: G.sphere, text: '炸弹 +1' },
  H: { mat: glowMat.pink, col: C.pink, geo: G.oct, text: '生命 +1' },
};
function dropPickup(x, y, z, kind) {
  if (!kind) {
    const pool = ['P', 'P', 'P', 'S', 'B'];
    if (P.lives < 4) pool.push('H', 'H');
    if (P.level >= 5) pool.push('B', 'S');
    kind = pick(pool);
  }
  const d = PICK[kind];
  const g = new THREE.Group();
  part(g, d.geo, d.mat, 0.7, kind === 'H' ? 0.9 : 0.7, 0.7);
  const t = part(g, G.torus, d.mat, 1.15, 1.15, 1.15);
  scene.add(g);
  pickups.push({ g, t, kind, x, y, z, age: 0 });
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.age += dt; p.z += 24 * dt;
    if (P.alive && p.z > -45) { const k = Math.min(1, dt * (p.z > -15 ? 7 : 2.5)); p.x += (P.x - p.x) * k; p.y += (P.y - p.y) * k; }
    p.g.position.set(p.x, p.y, p.z); p.g.rotation.y += dt * 3; p.t.rotation.x += dt * 4;
    const c = PICK[p.kind].col;
    if (Math.random() < 0.5) spark(p.x + rand(-0.6, 0.6), p.y + rand(-0.6, 0.6), p.z, 0, 2, -6, c.r, c.g, c.b, 0.5, 0.4, 0);
    if (P.alive && Math.abs(p.z) < 1.8 && Math.hypot(p.x - P.x, p.y - P.y) < 2.4) { collect(p); scene.remove(p.g); pickups.splice(i, 1); continue; }
    if (p.z > 14) { scene.remove(p.g); pickups.splice(i, 1); }
  }
}
function collect(p) {
  const d = PICK[p.kind];
  if (p.kind === 'P') {
    if (P.level < 5) { P.level++; sfx.power(); } else { addScore(500, P.x, P.y, 0, true); sfx.pickup(); }
    pbMesh.material.color.copy(LEVEL_COL[P.level - 1]);
  } else if (p.kind === 'S') { P.shield = true; sfx.shield(); }
  else if (p.kind === 'B') { P.bombs = Math.min(5, P.bombs + 1); sfx.pickup(); }
  else { P.lives = Math.min(5, P.lives + 1); sfx.pickup(); }
  popText(P.x, P.y + 1.5, 0, p.kind === 'P' && P.level >= 5 ? '火力全开！' : d.text, 'gold');
  shockwave(P.x, P.y, 0, d.col, 5, 0.35);
  for (let i = 0; i < 16; i++) { const a = Math.random() * 6.28; spark(P.x, P.y, 0, Math.cos(a) * 10, Math.sin(a) * 10, 0, d.col.r, d.col.g, d.col.b, 0.6, 0.4, 2); }
  updateHud();
}

// ---------------------------------------------------------------- 玩家
function findTarget() {
  let bestE = null, bestD = 1e9;
  for (const e of enemies) {
    if (e.z > -4 || e.z < -120 || e.dying > 0) continue;
    const d = Math.hypot(e.x - P.x, e.y - P.y) - e.r;
    const lim = e.type === 'boss' ? 7 : 3.4;
    if (d < lim && d < bestD) { bestD = d; bestE = e; }
  }
  return bestE;
}

const MUZZLES = [[0], [-0.6, 0.6], [-1.25, 0, 1.25], [-1.25, -0.45, 0.45, 1.25], [-1.9, -1.25, 0, 1.25, 1.9]];
function fire() {
  target = findTarget();
  const offs = MUZZLES[P.level - 1];
  for (const o of offs) {
    if (pBullets.length >= PB_MAX) break;
    const b = { x: P.x + o, y: P.y - 0.1, z: -1.2, vx: 0, vy: 0, vz: -1, q: new THREE.Quaternion() };
    if (target) {
      const lead = Math.abs(target.z) / 170;
      v0.set(target.x + (target.x - (target.px ?? target.x)) / Math.max(lastDt, 0.001) * lead + o * 0.35 - b.x, target.y + o * 0 - b.y, target.z - b.z).normalize();
    } else v0.set(o * 0.025, 0, -1).normalize();
    b.vx = v0.x * 170; b.vy = v0.y * 170; b.vz = v0.z * 170;
    b.q.setFromUnitVectors(FWD, v0);
    pBullets.push(b);
  }
  const c = LEVEL_COL[P.level - 1];
  spark(P.x, P.y, -1.6, 0, 0, -8, c.r * 0.6, c.g * 0.6, c.b * 0.6, 0.9, 0.05, 0);
  if (state === 'play') sfx.shoot();
}

function updatePlayer(dt) {
  if (!P.alive) return;
  // 键盘
  let kx = 0, ky = 0;
  if (keys.ArrowLeft || keys.KeyA) kx -= 1; if (keys.ArrowRight || keys.KeyD) kx += 1;
  if (keys.ArrowUp || keys.KeyW) ky += 1; if (keys.ArrowDown || keys.KeyS) ky -= 1;
  P.tx += kx * 16 * dt; P.ty += ky * 13 * dt;
  P.tx = clamp(P.tx, -field.x, field.x); P.ty = clamp(P.ty, field.yc - field.y, field.yc + field.y);
  const k = Math.min(1, dt * 16), ox = P.x, oy = P.y;
  P.x += (P.tx - P.x) * k; P.y += (P.ty - P.y) * k;
  const vx = (P.x - ox) / Math.max(dt, 0.001), vy = (P.y - oy) / Math.max(dt, 0.001);
  ship.position.set(P.x, P.y, 0);
  shipBody.rotation.z += (clamp(-vx * 0.05, -0.8, 0.8) - shipBody.rotation.z) * Math.min(1, dt * 10);
  shipBody.rotation.x += (clamp(vy * 0.03, -0.4, 0.4) - shipBody.rotation.x) * Math.min(1, dt * 10);
  shipBody.rotation.y = shipBody.rotation.z * -0.3;
  shipBody.position.y = Math.sin(time * 3) * 0.08;
  for (const f of flames) f.scale.y = 0.8 + Math.random() * 0.5;
  for (const s of [-0.42, 0.42]) spark(P.x + s, P.y, 2.2, rand(-0.5, 0.5), rand(-0.5, 0.5), 22, 0.12, 0.45, 1.0, 0.4, 0.2, 0);

  P.inv = Math.max(0, P.inv - dt);
  ship.visible = P.inv <= 0 || Math.floor(P.inv * 14) % 2 === 0;
  shieldMesh.visible = P.shield;
  if (P.shield) { shieldMesh.material.opacity = 0.09 + 0.04 * Math.sin(time * 8); shieldMesh.rotation.y += dt * 2; }

  P.fireT -= dt;
  if (P.fireT <= 0) { P.fireT = 0.15; fire(); }
}

function hurtPlayer() {
  if (!P.alive || P.inv > 0 || state !== 'play') return;
  if (P.shield) {
    P.shield = false; P.inv = 1; sfx.shield(); shake(0.4);
    shockwave(P.x, P.y, 0, C.cyan, 9, 0.4); popText(P.x, P.y + 1.5, 0, '护盾挡住了！');
    return;
  }
  P.lives--; P.inv = 2.2; combo = 0; if (P.level > 1) P.level--;
  pbMesh.material.color.copy(LEVEL_COL[P.level - 1]);
  flash('red'); shake(0.8); sfx.hurt();
  if (navigator.vibrate) navigator.vibrate(120);
  explode(P.x, P.y, 0, C.orange, 0.8, true);
  eBullets.length = 0;
  if (P.lives <= 0) {
    P.alive = false; P.deadT = 1.4; ship.visible = false; shieldMesh.visible = false; reticle.visible = false;
    explode(P.x, P.y, 0, C.cyan, 2.5); explode(P.x, P.y, 0, C.orange, 2, true);
    timeScale = 0.3; slowT = 0.8; stopMusic(); sfx.over();
  }
  updateHud();
}

function useBomb() {
  if (state !== 'play' || !P.alive || P.bombs <= 0) return;
  P.bombs--; P.inv = Math.max(P.inv, 1.2);
  flash('white'); shake(1); sfx.bomb();
  if (navigator.vibrate) navigator.vibrate(200);
  shockwave(P.x, P.y, 0, C.white, 90, 0.8); shockwave(P.x, P.y, 0, C.gold, 60, 1.0); shockwave(P.x, 0.3, -20, C.cyan, 120, 1.0, true);
  for (const b of eBullets) spark(b.x, b.y, b.z, 0, 0, 0, C.gold.r, C.gold.g, C.gold.b, 2, 0.4, 0);
  eBullets.length = 0;
  for (let i = 0; i < 90; i++) { const a = Math.random() * 6.28, s = rand(20, 70); spark(P.x, P.y, -2, Math.cos(a) * s, Math.sin(a) * s * 0.6, -rand(20, 90), 2, rand(0.8, 1.6), 0.4, rand(0.8, 1.6), rand(0.5, 1.1), 1.2); }
  for (const e of enemies.slice()) if (e.z > -140) damageEnemy(e, e.type === 'boss' ? 60 : 40);
  floorPulse = 1;
  updateHud();
}

// ---------------------------------------------------------------- 子弹更新
function updateBullets(dt) {
  for (let i = pBullets.length - 1; i >= 0; i--) {
    const b = pBullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    let dead = b.z < -170;
    if (!dead) {
      const step = 170 * dt + 1.2;
      for (const e of enemies) {
        if (e.dying > 0) continue;
        if (b.z < e.z + e.r && b.z > e.z - e.r - step && Math.hypot(b.x - e.x, b.y - e.y) < e.r + 0.45) {
          dead = true;
          const c = LEVEL_COL[P.level - 1];
          for (let k = 0; k < 4; k++) spark(b.x, b.y, e.z + e.r * 0.7, rand(-9, 9), rand(-9, 9), rand(4, 16), c.r, c.g, c.b, 0.5, 0.25, 2);
          if (state === 'play') sfx.hit();
          damageEnemy(e, 1);
          break;
        }
      }
    }
    if (dead) { pBullets[i] = pBullets[pBullets.length - 1]; pBullets.pop(); }
  }
  for (let i = eBullets.length - 1; i >= 0; i--) {
    if (i >= eBullets.length) continue;
    const b = eBullets[i];
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (Math.random() < 0.35) spark(b.x, b.y, b.z, 0, 0, -4, C.pink.r, C.pink.g * 0.6, C.pink.b, 0.8, 0.22, 0);
    let dead = b.z > 12;
    if (!dead && P.alive && Math.abs(b.z) < 0.7 + b.vz * dt && Math.hypot(b.x - P.x, b.y - P.y) < 0.95) { dead = true; hurtPlayer(); }
    if (dead && i < eBullets.length) { eBullets[i] = eBullets[eBullets.length - 1]; eBullets.pop(); }
  }
  let n = 0;
  for (const b of pBullets) { v0.set(b.x, b.y, b.z); m4.compose(v0, b.q, ONE); pbMesh.setMatrixAt(n++, m4); }
  pbMesh.count = n; pbMesh.instanceMatrix.needsUpdate = true;
  n = 0; q0.identity();
  for (const b of eBullets) { v0.set(b.x, b.y, b.z); v1.setScalar(1 + 0.2 * Math.sin(time * 14 + b.ph)); m4.compose(v0, q0, v1); ebMesh.setMatrixAt(n++, m4); }
  ebMesh.count = n; ebMesh.instanceMatrix.needsUpdate = true;
}

// ---------------------------------------------------------------- 波次
function startWave(n) {
  wave = n; waveState = 'spawning';
  $('wave').textContent = n;
  if (n % 5 === 0) {
    banner('警告！', '机械魔王来了', true); sfx.warn(); setIntense(true);
    spawnQ.push({ t: 2.2, type: 'boss' });
    return;
  }
  banner(`第 ${n} 波`, pick(['外星机器人来了！', '准备战斗！', '冲啊，小战士！', '保护地球！']), false);
  sfx.wave();
  const count = Math.min(4 + Math.floor(n * 1.2), 14);
  const bag = ['drone', 'drone', 'drone'];
  if (n >= 2) bag.push('bot', 'bot');
  if (n >= 3) bag.push('spike', 'spike');
  if (n >= 6) bag.push('tank');
  let tanks = 0;
  for (let i = 0; i < count; i++) {
    let type = n === 1 ? 'drone' : pick(bag);
    if (type === 'tank' && ++tanks > 1 + Math.floor(n / 8)) type = 'bot';
    spawnQ.push({ t: 1.2 + i * 0.45, type });
  }
}
function updateWaves(dt) {
  if (!P.alive) return;
  for (let i = spawnQ.length - 1; i >= 0; i--) {
    const s = spawnQ[i]; s.t -= dt;
    if (s.t <= 0) {
      spawnQ.splice(i, 1);
      const e = spawnEnemy(s.type);
      if (s.type === 'boss') { boss = e; $('bossBar').classList.add('on'); $('bossFill').style.width = '100%'; }
    }
  }
  if (waveState === 'spawning' && spawnQ.length === 0 && enemies.length === 0) {
    waveState = 'clear'; waveT = 1.6;
    if (wave > 0) { addScore(wave * 200, P.x, P.y + 2, 0, true); if (wave % 5) dropPickup(rand(-1, 1) * field.x * 0.6, field.yc, -70); }
  } else if (waveState === 'clear') {
    waveT -= dt;
    if (waveT <= 0) startWave(wave + 1);
  }
}

// ---------------------------------------------------------------- 分数与界面
function addScore(base, x, y, z, bonus = false) {
  let mult = 1;
  if (!bonus) {
    combo++; comboT = 3;
    mult = Math.min(8, 1 + Math.floor(combo / 5));
    const el = $('combo');
    if (combo >= 3) {
      el.textContent = `连击 ${combo}` + (mult > 1 ? `  ×${mult}` : '');
      el.classList.add('on'); el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
    }
  }
  const pts = base * mult;
  score += pts;
  popText(x, y, z, `+${pts}`, bonus || mult > 1 ? 'gold' : '');
  $('score').textContent = score;
}

let popCount = 0;
function popText(x, y, z, text, cls = '') {
  if (popCount > 14) return;
  v1.set(x, y, z).project(camera);
  if (v1.z > 1) return;
  const el = document.createElement('div');
  el.className = `ft ${cls}`; el.textContent = text;
  el.style.left = `${clamp((v1.x * 0.5 + 0.5) * viewW, 40, viewW - 40)}px`;
  el.style.top = `${clamp((-v1.y * 0.5 + 0.5) * viewH, 60, viewH - 40)}px`;
  $('fx').appendChild(el); popCount++;
  setTimeout(() => { el.remove(); popCount--; }, 900);
}

function banner(main, sub, warn) {
  const b = $('banner');
  $('bannerMain').textContent = main; $('bannerSub').textContent = sub;
  b.className = ''; void b.offsetWidth; b.className = warn ? 'show warn' : 'show';
}
function flash(kind) { const f = $('flash'); f.className = ''; void f.offsetWidth; f.className = kind; }

function updateHud() {
  $('hearts').textContent = (P.shield ? '🛡️' : '') + '❤️'.repeat(Math.max(0, P.lives));
  $('bombCount').textContent = P.bombs;
  $('bombBtn').classList.toggle('empty', P.bombs <= 0);
  $('best').textContent = `最高 ${Math.max(best, score)}`;
  $('score').textContent = score;
}

// ---------------------------------------------------------------- 流程
function clearWorld() {
  for (const e of enemies.slice()) removeEnemy(e);
  for (const p of pickups) scene.remove(p.g);
  pickups.length = 0; pBullets.length = 0; eBullets.length = 0; spawnQ.length = 0;
  boss = null; target = null; reticle.visible = false;
  $('bossBar').classList.remove('on');
}

function startGame() {
  initAudio();
  clearWorld();
  score = 0; wave = 0; combo = 0; timeScale = 1; slowT = 0;
  Object.assign(P, { x: 0, y: field.yc, tx: 0, ty: field.yc, lives: 4, shield: false, inv: 1.5, level: 1, bombs: 2, fireT: 0.3, alive: true });
  pbMesh.material.color.copy(LEVEL_COL[0]);
  ship.visible = true;
  waveState = 'clear'; waveT = 0.8;
  state = 'play';
  $('menu').classList.add('hidden'); $('over').classList.add('hidden'); $('pauseOv').classList.add('hidden');
  $('hud').classList.remove('hidden'); $('combo').classList.remove('on');
  updateHud(); setIntense(false); startMusic();
  const el = document.documentElement;
  if (matchMedia('(pointer: coarse)').matches && el.requestFullscreen && !document.fullscreenElement) el.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
}

function gameOver() {
  state = 'over';
  const isBest = score > best;
  if (isBest) { best = score; try { localStorage.setItem('gw_best', String(best)); } catch (e) { /* ignore */ } }
  $('overScore').textContent = score; $('overWave').textContent = wave; $('overBest').textContent = best;
  $('newBest').classList.toggle('hidden', !isBest || score === 0);
  $('over').classList.remove('hidden'); $('hud').classList.add('hidden'); $('banner').className = '';
}

function setPaused(p) {
  if (p && state === 'play') { state = 'pause'; $('pauseOv').classList.remove('hidden'); suspendAudio(true); }
  else if (!p && state === 'pause') { state = 'play'; $('pauseOv').classList.add('hidden'); suspendAudio(false); last = performance.now(); }
}

// ---------------------------------------------------------------- 输入
const keys = {};
let movePid = null, lastPX = 0, lastPY = 0;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play' || movePid !== null) return;
  movePid = e.pointerId; lastPX = e.clientX; lastPY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerId !== movePid || state !== 'play') return;
  const k = unitsPerPx * 1.7;
  P.tx = clamp(P.tx + (e.clientX - lastPX) * k, -field.x, field.x);
  P.ty = clamp(P.ty - (e.clientY - lastPY) * k, field.yc - field.y, field.yc + field.y);
  lastPX = e.clientX; lastPY = e.clientY;
});
const release = (e) => { if (e.pointerId === movePid) movePid = null; };
canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);
window.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); if (state === 'play') useBomb(); else if (state === 'menu' || state === 'over') startGame(); }
  if (e.code === 'KeyP' || e.code === 'Escape') setPaused(state === 'play');
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
for (const ev of ['contextmenu', 'gesturestart', 'dblclick']) document.addEventListener(ev, (e) => e.preventDefault());
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

const tap = (id, fn) => $(id).addEventListener('click', (e) => { e.stopPropagation(); fn(); });
tap('startBtn', startGame); tap('againBtn', startGame);
tap('pauseBtn', () => setPaused(true)); tap('resumeBtn', () => setPaused(false));
$('bombBtn').addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); useBomb(); });
const muteBtn = $('muteBtn');
const showMute = () => { muteBtn.textContent = isMuted() ? '🔇' : '🔊'; };
tap('muteBtn', () => { setMuted(!isMuted()); showMute(); });
showMute();
document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------------------------------------------------------------- 主循环
let last = performance.now(), lastDt = 0.016, floorPulse = 0, fpsT = 0, fpsN = 0, lowCount = 0;
const camPos = new THREE.Vector3(0, 6, CAM_DIST), camLook = new THREE.Vector3(0, 5, -30);

function updateScenery(dt) {
  floorMat.uniforms.uOff.value = (floorMat.uniforms.uOff.value + WORLD_SPEED * dt) % 1000;
  floorPulse = Math.max(0, floorPulse - dt * 1.5); floorMat.uniforms.uPulse.value = floorPulse * 2;
  sun.material.uniforms.uT.value = time;
  planet.rotation.y += dt * 0.02;
  for (let i = 0; i < STAR_N; i++) { let z = starPos[i * 3 + 2] + dt * 12; if (z > -120) z -= 300; starPos[i * 3 + 2] = z; }
  starGeo.attributes.position.needsUpdate = true;
  for (let i = 0; i < PYL_N; i++) {
    const p = pylData[i]; p.z += WORLD_SPEED * dt;
    if (p.z > 20) { p.z -= PYL_N * 9; p.h = rand(6, 26); }
    v0.set(p.x, p.h / 2, p.z); v1.set(p.w, p.h, p.w); q0.identity(); m4.compose(v0, q0, v1); pylons.setMatrixAt(i, m4);
    v0.set(p.x, p.h + 0.3, p.z); v1.set(p.w * 1.15, 0.5, p.w * 1.15); m4.compose(v0, q0, v1); pylTops.setMatrixAt(i, m4);
  }
  pylons.instanceMatrix.needsUpdate = pylTops.instanceMatrix.needsUpdate = true;
  for (const g of gates) { g.position.z += WORLD_SPEED * dt; if (g.position.z > 20) g.position.z -= 320; }
}

function updateCamera(rdt) {
  const fx = P.x, fy = P.y - field.yc;
  v0.set(fx * 0.74, field.yc + fy * 0.7 + 2.6, CAM_DIST);
  camPos.lerp(v0, Math.min(1, rdt * 7));
  camLook.lerp(v1.set(fx * 0.82, field.yc + fy * 0.8 - 0.6, -30), Math.min(1, rdt * 7));
  trauma = Math.max(0, trauma - rdt * 1.6);
  const s = trauma * trauma;
  camera.position.set(camPos.x + rand(-1, 1) * s * 0.9, camPos.y + rand(-1, 1) * s * 0.9, camPos.z + rand(-1, 1) * s * 0.4);
  camera.lookAt(camLook);
  camera.rotation.z += rand(-1, 1) * s * 0.06 - shipBody.rotation.z * 0.06;
  sky.position.copy(camera.position);
}

function updateReticle(dt) {
  if (target && (target.hp <= 0 || !enemies.includes(target))) target = null;
  if (!target || !P.alive) { reticle.visible = false; return; }
  reticle.visible = true;
  reticle.position.set(target.x, target.y, target.z);
  reticle.quaternion.copy(camera.quaternion);
  const s = target.r * 1.25 * (1 + 0.08 * Math.sin(time * 12));
  reticle.scale.setScalar(s);
  reticle.userData.r1.rotation.z += dt * 2.5; reticle.userData.r2.rotation.z -= dt * 5;
}

function frame(now) {
  requestAnimationFrame(frame);
  const rdt = Math.min((now - last) / 1000, 0.05); last = now;
  if (state === 'pause') return;
  if (slowT > 0) slowT -= rdt; else timeScale += (1 - timeScale) * Math.min(1, rdt * 3);
  const dt = rdt * timeScale;
  time += dt;

  updateScenery(dt);
  if (state === 'menu') {
    P.tx = Math.sin(time * 0.7) * field.x * 0.5; P.ty = field.yc + Math.sin(time * 1.1) * 1.2;
    updatePlayer(dt); updateBullets(dt);
  } else {
    for (const e of enemies) e.px = e.x;
    updatePlayer(dt); updateWaves(dt); updateEnemies(dt); updateBullets(dt); updatePickups(dt);
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) { combo = 0; $('combo').classList.remove('on'); } }
    if (!P.alive && state === 'play') { P.deadT -= rdt; if (P.deadT <= 0) gameOver(); }
  }
  lastDt = dt;
  updateParticles(dt); updateCamera(rdt); updateRings(dt); updateReticle(dt);

  if (quality > 0) composer.render(); else renderer.render(scene, camera);

  // 自动画质：太卡就降一档，保证流畅
  if (forcedQ < 0 && state === 'play') {
    fpsT += rdt; fpsN++;
    if (fpsT >= 2) {
      const fps = fpsN / fpsT; fpsT = 0; fpsN = 0;
      if (fps < 42 && quality > 0) { if (++lowCount >= 2) { quality--; lowCount = 0; resize(); } } else lowCount = 0;
    }
  }
}

resize();
P.y = P.ty = field.yc;
updateHud();
requestAnimationFrame(frame);

if (params.has('debug')) window.__game = { P, enemies, eBullets, get state() { return state; }, get wave() { return wave; }, get score() { return score; }, get quality() { return quality; }, startWave, useBomb, hurtPlayer, dropPickup, spawnEnemy };
