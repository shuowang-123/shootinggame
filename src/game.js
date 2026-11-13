// 银河小战士 —— 原创 3D 星际射击游戏
import * as THREE from '../vendor/three.module.min.js';
import { EffectComposer } from '../vendor/EffectComposer.js';
import { RenderPass } from '../vendor/RenderPass.js';
import { UnrealBloomPass } from '../vendor/UnrealBloomPass.js';
import { OutputPass } from '../vendor/OutputPass.js';
import { ShaderPass } from '../vendor/ShaderPass.js';
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

const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.5, 0.9);
composer.addPass(bloom);
// 镜头效果：暗角 + 受击时的色散
const lensPass = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uAb: { value: 0.012 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uAb; varying vec2 vUv;
    void main(){
      vec2 c = vUv - 0.5; float d = dot(c, c); vec2 o = c * d * uAb;
      vec3 col = vec3(texture2D(tDiffuse, vUv + o).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - o).b);
      col *= 1.0 - d * 0.85;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(lensPass);
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
  field.y = clamp(halfH * 0.5, 2.4, 4.6);
  field.yc = field.y + 2.3;
  unitsPerPx = (2 * halfH) / viewH;
  const dpr = window.devicePixelRatio || 1;
  const pr = quality === 2 ? Math.min(dpr, 2) : quality === 1 ? Math.min(dpr, 1.5) : Math.min(dpr, 1.25);
  const samples = quality === 2 ? 4 : 0;
  if (composer.renderTarget1.samples !== samples) {
    composer.renderTarget1.samples = composer.renderTarget2.samples = samples;
    composer.renderTarget1.dispose(); composer.renderTarget2.dispose();
  }
  renderer.setPixelRatio(pr);
  renderer.setSize(viewW, viewH, false);
  composer.setPixelRatio(pr);
  composer.setSize(viewW, viewH);
  starMat.uniforms.uPR.value = pr;
  if (particleMat) particleMat.uniforms.uScale.value = (viewH * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// ---------------------------------------------------------------- 灯光与天空
scene.add(new THREE.HemisphereLight(0x9fc4ff, 0x5a2a88, 0.9));
const sunLight = new THREE.DirectionalLight(0xffffff, 2.0);
sunLight.position.set(4, 10, 8);
scene.add(sunLight);

// 星云天空：开场时一次性画到贴图上，之后每帧零开销；同一张图也用来给金属做反光
function bakeSky(w, h, env) {
  const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
  rt.texture.wrapS = THREE.RepeatWrapping;
  const mat = new THREE.ShaderMaterial({
    uniforms: { uFog: { value: FOG }, uEnv: { value: env ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform vec3 uFog; uniform float uEnv; varying vec2 vUv;
      float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
      float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                   mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }
      float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 6; i++) { s += a * noise(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
      void main(){
        float phi = vUv.x * 6.2831853, th = (1.0 - vUv.y) * 3.14159265;
        vec3 d = vec3(-cos(phi) * sin(th), cos(th), sin(phi) * sin(th));
        float h = clamp(d.y, 0.0, 1.0);
        vec3 col = mix(uFog, vec3(0.012, 0.004, 0.05), pow(h, 0.45));
        float n1 = fbm(d * 2.2 + vec3(3.1, 0.0, 1.7));
        float n2 = fbm(d * 3.7 + vec3(-5.0, 2.0, 9.0) + n1 * 1.5);
        float n3 = fbm(d * 6.0 + 20.0);
        float mask = smoothstep(0.05, 0.45, h);
        col += vec3(0.55, 0.12, 0.8) * pow(smoothstep(0.4, 0.8, n2), 1.5) * 0.75 * mask;
        col += vec3(0.06, 0.35, 0.9) * pow(smoothstep(0.42, 0.85, n1), 1.5) * 0.65 * mask;
        col += vec3(1.0, 0.3, 0.5) * pow(smoothstep(0.5, 0.9, n3), 2.0) * 0.4 * mask;
        float s = max(dot(d, normalize(vec3(0.0, 0.07, -1.0))), 0.0);
        col += vec3(1.0, 0.35, 0.55) * pow(s, 24.0) * 0.3;
        if (d.y < 0.0) col = mix(uFog, vec3(0.02, 0.25, 0.5), clamp(-d.y * 1.5, 0.0, 1.0));
        if (uEnv > 0.5) {
          col *= 1.6;
          col += vec3(1.0, 0.95, 0.9) * pow(max(dot(d, normalize(vec3(0.2, 1.0, 0.3))), 0.0), 6.0) * 2.2;
          col += vec3(0.2, 0.9, 1.6) * pow(max(dot(d, normalize(vec3(-1.0, 0.25, 0.2))), 0.0), 5.0) * 2.0;
          col += vec3(1.6, 0.3, 0.9) * pow(max(dot(d, normalize(vec3(1.0, 0.25, 0.2))), 0.0), 5.0) * 2.0;
          col += vec3(1.4, 0.8, 0.3) * pow(s, 8.0) * 1.5;
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const sc = new THREE.Scene(); sc.add(quad);
  renderer.setRenderTarget(rt); renderer.render(sc, new THREE.Camera()); renderer.setRenderTarget(null);
  mat.dispose(); quad.geometry.dispose();
  return rt;
}
const skyTex = bakeSky(2048, 1024, false).texture;
skyTex.generateMipmaps = false;
{
  const envRT = bakeSky(512, 256, true);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(envRT.texture).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose(); envRT.dispose();
}
const sky = new THREE.Mesh(
  new THREE.SphereGeometry(600, 48, 24),
  new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, depthWrite: false, fog: false }),
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

// 星星：圆润、大小不一、会闪烁
const STAR_N = 1500;
const starGeo = new THREE.BufferGeometry();
{
  const pos = new Float32Array(STAR_N * 3), dat = new Float32Array(STAR_N * 2), col = new Float32Array(STAR_N * 3);
  for (let i = 0; i < STAR_N; i++) {
    const u = Math.random() * 0.98 + 0.02, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u) * 560;
    pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = u * 560; pos[i * 3 + 2] = Math.sin(a) * r;
    dat[i * 2] = Math.random() < 0.08 ? rand(3.5, 5.5) : rand(1.2, 2.8); dat[i * 2 + 1] = Math.random() * 6.28;
    const c = pick([[1, 1, 1], [0.7, 0.85, 1], [1, 0.8, 0.9], [1, 0.95, 0.7]]);
    col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aDat', new THREE.BufferAttribute(dat, 2));
  starGeo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
}
const starMat = new THREE.ShaderMaterial({
  uniforms: { uT: { value: 0 }, uPR: { value: 1 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  vertexShader: `
    attribute vec2 aDat; attribute vec3 aCol; uniform float uT; uniform float uPR; varying vec3 vC;
    void main(){ float tw = 0.65 + 0.35 * sin(uT * 2.5 + aDat.y); vC = aCol * tw;
      gl_PointSize = aDat.x * uPR; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    varying vec3 vC;
    void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vC * 1.3, a * a); }`,
});
const stars = new THREE.Points(starGeo, starMat);
stars.frustumCulled = false; stars.renderOrder = -8;
scene.add(stars);

// 霓虹网格地面
const WORLD_SPEED = 62;
const floorMat = new THREE.ShaderMaterial({
  uniforms: { uOff: { value: 0 }, uFog: { value: FOG }, uPulse: { value: 0 } },
  vertexShader: `
    uniform float uOff; varying vec3 vW; varying float vH; varying float vM;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(hash(i), hash(i + vec2(1,0)), f.x), mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y); }
    void main(){
      vec4 w = modelMatrix * vec4(position, 1.0);
      vec2 p = vec2(w.x, w.z - uOff);
      float m = smoothstep(58.0, 150.0, abs(w.x));
      float h = noise(p * 0.02) * 0.65 + noise(p * 0.055) * 0.35;
      h = pow(h, 1.5) * 80.0 * m;
      w.y += h; vH = h; vM = m; vW = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`,
  fragmentShader: `
    uniform float uOff; uniform float uPulse; uniform vec3 uFog; varying vec3 vW; varying float vH; varying float vM;
    void main(){
      vec2 p = vec2(vW.x, vW.z - uOff) / 5.0;
      vec2 g = abs(fract(p - 0.5) - 0.5) / fwidth(p);
      float line = 1.0 - min(min(g.x, g.y), 1.0);
      vec2 p2 = p * 5.0;
      vec2 g2 = abs(fract(p2 - 0.5) - 0.5) / fwidth(p2);
      float d = length(vW.xz - cameraPosition.xz);
      float line2 = (1.0 - min(min(g2.x, g2.y), 1.0)) * 0.16 * exp(-d * 0.045);
      float node = smoothstep(0.07, 0.0, length(abs(fract(p - 0.5) - 0.5))) * exp(-d * 0.02);
      float fade = exp(-d * mix(0.011, 0.0065, vM));
      vec3 lc = mix(vec3(0.1, 0.95, 1.7), vec3(1.7, 0.2, 1.3), smoothstep(15.0, 110.0, d));
      lc = mix(lc, vec3(1.9, 1.0, 0.3), smoothstep(10.0, 50.0, vH));
      float wave = 0.5 + 0.5 * sin((vW.z - uOff) * 0.08);
      float sr = exp(-abs(vW.x) * 0.045) * smoothstep(25.0, 160.0, d) * (0.55 + 0.45 * sin((vW.z - uOff) * 0.5 + sin(vW.x * 0.7) * 2.0)) * (1.0 - vM);
      vec3 col = vec3(0.02, 0.0, 0.07) + vec3(0.07, 0.0, 0.12) * smoothstep(0.0, 45.0, vH);
      col += lc * line * (0.75 + uPulse) + lc * line2 + lc * node * 1.4 + lc * 0.05 * wave + vec3(1.0, 0.3, 0.5) * sr * 0.3;
      gl_FragColor = vec4(mix(uFog, col, fade), 1.0);
    }`,
});
const floor = new THREE.Mesh(new THREE.PlaneGeometry(900, 700, 180, 140), floorMat);
floor.rotation.x = -Math.PI / 2; floor.position.z = -300;
floor.frustumCulled = false;
scene.add(floor);

// 两侧飞驰而过的光塔和头顶的光环门
const PYL_N = 40;
const pylGeo = new THREE.BoxGeometry(1, 1, 1);
const pylons = new THREE.InstancedMesh(pylGeo, new THREE.ShaderMaterial({
  uniforms: { uFog: { value: FOG } },
  vertexShader: `
    varying vec3 vL; varying vec3 vN; varying vec3 vCol; varying vec3 vS; varying float vDepth;
    void main(){
      vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vL = position; vN = normal; vCol = instanceColor;
      vS = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      vec4 mv = viewMatrix * w; vDepth = -mv.z; gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uFog; varying vec3 vL; varying vec3 vN; varying vec3 vCol; varying vec3 vS; varying float vDepth;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      float side = step(abs(vN.y), 0.5);
      float u = (abs(vN.x) > 0.5 ? vL.z : vL.x) * vS.x;
      vec2 cell = vec2(u * 1.7 + 0.5, vL.y * vS.y * 0.85);
      vec2 id = floor(cell), f = fract(cell);
      float lit = step(0.42, hash(id + floor(vS.y * 7.0)));
      float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.3, f.y) * step(f.y, 0.78);
      float edge = smoothstep(0.44, 0.5, abs((abs(vN.x) > 0.5 ? vL.z : vL.x)));
      vec3 col = vec3(0.035, 0.02, 0.09) + vCol * win * lit * 0.5 * side + vCol * edge * side * 0.7;
      col += vCol * smoothstep(0.455, 0.47, vL.y) * 1.2;
      gl_FragColor = vec4(mix(col, uFog, smoothstep(70.0, 260.0, vDepth)), 1.0);
    }`,
}), PYL_N);
pylons.frustumCulled = false;
const pylData = [];
for (let i = 0; i < PYL_N; i++) {
  const side = i % 2 ? 1 : -1;
  pylData.push({ x: side * rand(24, 56), z: -i * 8 + 10, h: rand(8, 34), w: rand(2, 4.5) });
  pylons.setColorAt(i, new THREE.Color().setHSL(pick([0.52, 0.85, 0.12, 0.58]), 1, 0.5).multiplyScalar(1.9));
}
scene.add(pylons);
const gates = [];
for (let i = 0; i < 4; i++) {
  const col = i % 2 ? new THREE.Color(2.0, 0.3, 1.4) : new THREE.Color(0.3, 1.5, 2.2);
  const g = new THREE.Mesh(new THREE.TorusGeometry(24, 0.3, 12, 96, Math.PI), new THREE.MeshBasicMaterial({ color: col }));
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
      gl_PointSize = min(aSize * uScale / max(-mv.z, 0.5), 260.0); gl_Position = projectionMatrix * mv; }`,
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

// 爆炸火球
const fireballs = [];
for (let i = 0; i < 10; i++) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color() }, uA: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform vec3 uCol; uniform float uA; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(max(dot(normalize(vN), normalize(vV)), 0.0), 2.2); gl_FragColor = vec4(mix(uCol, vec3(1.5, 1.4, 1.2), f * uA), f * uA); }',
  }));
  m.visible = false; m.renderOrder = 4; scene.add(m);
  fireballs.push({ m, t: 0, life: 0, s: 1 });
}
let fbIdx = 0;
function fireball(x, y, z, color, s, life = 0.38) {
  const f = fireballs[fbIdx]; fbIdx = (fbIdx + 1) % fireballs.length;
  f.m.position.set(x, y, z); f.m.material.uniforms.uCol.value.copy(color); f.m.visible = true; f.t = 0; f.life = life; f.s = s;
}
// 爆炸飞出的金属碎片
const DEB_N = 110;
const debMesh = new THREE.InstancedMesh(new THREE.TetrahedronGeometry(0.4), new THREE.MeshStandardMaterial({ color: 0x8a90b0, roughness: 0.3, metalness: 0.9 }), DEB_N);
debMesh.frustumCulled = false; debMesh.count = 0; scene.add(debMesh);
const debris = [], debEuler = new THREE.Euler(), debQ = new THREE.Quaternion(), debP = new THREE.Vector3(), debS = new THREE.Vector3(), debM = new THREE.Matrix4();
function spawnDebris(x, y, z, n, power) {
  for (let i = 0; i < n; i++) {
    if (debris.length >= DEB_N) debris.shift();
    const u = Math.random() * 2 - 1, th = Math.random() * 6.28, s = Math.sqrt(1 - u * u), sp = rand(8, 22) * power;
    debris.push({ x, y, z, vx: s * Math.cos(th) * sp, vy: Math.abs(u) * sp + 4, vz: s * Math.sin(th) * sp + 14, rx: rand(0, 6), ry: rand(0, 6), rs: rand(4, 14), life: rand(0.9, 1.7), s: rand(0.5, 1.3) * Math.sqrt(power) });
  }
}
function updateFx(dt) {
  for (const f of fireballs) {
    if (!f.m.visible) continue;
    f.t += dt; const k = f.t / f.life;
    if (k >= 1) { f.m.visible = false; continue; }
    f.m.scale.setScalar(f.s * (0.35 + 0.65 * (1 - (1 - k) * (1 - k))));
    f.m.material.uniforms.uA.value = Math.pow(1 - k, 1.4);
  }
  let n = 0;
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    d.life -= dt;
    if (d.life <= 0) { debris.splice(i, 1); continue; }
    d.vy -= 30 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
    if (d.y < 0.3) { d.y = 0.3; d.vy *= -0.45; d.vx *= 0.7; }
    d.rx += d.rs * dt; d.ry += d.rs * 0.7 * dt;
    debEuler.set(d.rx, d.ry, 0); debQ.setFromEuler(debEuler);
    debP.set(d.x, d.y, d.z); debS.setScalar(d.s * Math.min(1, d.life * 3));
    debM.compose(debP, debQ, debS); debMesh.setMatrixAt(n++, debM);
  }
  debMesh.count = n; debMesh.instanceMatrix.needsUpdate = true;
}

function explode(x, y, z, color, scale = 1, quiet = false) {
  fireball(x, y, z, color, 2.6 * scale);
  spawnDebris(x, y, z, Math.round(4 + scale * 3), 0.7 + scale * 0.3);
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
  sphere: new THREE.SphereGeometry(1, 32, 20), box: new THREE.BoxGeometry(1, 1, 1), cone: new THREE.ConeGeometry(1, 1, 24),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 24), torus: new THREE.TorusGeometry(1, 0.1, 12, 64), oct: new THREE.OctahedronGeometry(1),
  ico: new THREE.IcosahedronGeometry(1, 0),
};
const glowMat = {};
for (const k in C) glowMat[k] = new THREE.MeshBasicMaterial({ color: C[k] });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x2a2a44, roughness: 0.28, metalness: 0.9 });
const std = (color, emissive = 0x000000) => new THREE.MeshStandardMaterial({ color, emissive, roughness: 0.26, metalness: 0.72 });

function part(parent, geo, mat, sx, sy, sz, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); parent.add(m);
  return m;
}

// ---------------------------------------------------------------- 玩家飞船
const ship = new THREE.Group();
const shipBody = new THREE.Group();
ship.add(shipBody);
function extrude(pts, depth) {
  const sh = new THREE.Shape();
  pts.forEach(([x, y], i) => (i ? sh.lineTo(x, y) : sh.moveTo(x, y)));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2);
  return g;
}
const HERO_K = 1.55;
shipBody.scale.setScalar(HERO_K);
const yAxis = new THREE.Vector3(0, 1, 0);
function limb(parent, mat, r, ax, ay, az, bx, by, bz) {
  const a = new THREE.Vector3(ax, ay, az), b = new THREE.Vector3(bx, by, bz), d = b.clone().sub(a);
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, d.length(), 4, 12), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(yAxis, d.normalize());
  parent.add(m);
  return m;
}
const hero = { scarf: [], gunMount: new THREE.Group(), gun: null, pop: 0, recoil: 0 };
{
  const soft = (color, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  const skin = soft(0xffc7a0), hair = soft(0x3a2212, 0.5), suit = std(0x1c5cff), armor = std(0xd5dcf0), red = soft(0xff2b3f, 0.45);
  suit.metalness = 0.35; suit.roughness = 0.4; armor.roughness = 0.2;
  // 飞行滑板
  const boardG = extrude([[-0.4, -1.25], [0.4, -1.25], [0.52, -0.7], [0.52, 0.9], [0.24, 1.7], [-0.24, 1.7], [-0.52, 0.9], [-0.52, -0.7]], 0.1); boardG.rotateX(-Math.PI / 2);
  part(shipBody, boardG, armor, 1, 1, 1, 0, -1.08, 0.1);
  part(shipBody, G.box, glowMat.cyan, 0.5, 0.03, 2.2, 0, -1.17, 0.0);
  for (const s of [-1, 1]) {
    part(shipBody, G.box, glowMat.pink, 0.04, 0.05, 1.6, s * 0.54, -1.08, 0.0);
    const th = part(shipBody, G.cyl, darkMat, 0.14, 0.5, 0.14, s * 0.26, -1.08, 1.4); th.rotation.x = Math.PI / 2;
    part(shipBody, G.torus, glowMat.cyan, 0.15, 0.15, 0.5, s * 0.26, -1.08, 1.66);
  }
  // 腿和靴子（冲浪站姿）
  limb(shipBody, suit, 0.13, -0.16, -0.32, 0.05, -0.2, -0.9, 0.4);
  limb(shipBody, suit, 0.13, 0.16, -0.32, -0.05, 0.2, -0.9, -0.35);
  part(shipBody, G.box, armor, 0.26, 0.2, 0.46, -0.2, -0.95, 0.36);
  part(shipBody, G.box, armor, 0.26, 0.2, 0.46, 0.2, -0.95, -0.4);
  part(shipBody, G.box, glowMat.cyan, 0.27, 0.04, 0.47, -0.2, -1.0, 0.36);
  part(shipBody, G.box, glowMat.cyan, 0.27, 0.04, 0.47, 0.2, -1.0, -0.4);
  // 身体、盔甲、喷气背包
  part(shipBody, G.sphere, suit, 0.36, 0.44, 0.28, 0, 0.02, 0);
  part(shipBody, G.sphere, armor, 0.39, 0.26, 0.31, 0, 0.2, 0);
  const belt = part(shipBody, G.torus, glowMat.gold, 0.31, 0.25, 0.5, 0, -0.26, 0); belt.rotation.x = Math.PI / 2;
  part(shipBody, G.box, darkMat, 0.42, 0.46, 0.2, 0, 0.14, 0.32);
  part(shipBody, G.sphere, glowMat.cyan, 0.1, 0.1, 0.05, 0, 0.2, 0.43);
  for (const s of [-1, 1]) {
    part(shipBody, G.sphere, armor, 0.17, 0.15, 0.17, s * 0.4, 0.3, 0);
    const nz = part(shipBody, G.cyl, darkMat, 0.07, 0.2, 0.07, s * 0.13, -0.12, 0.36); nz.rotation.x = 0.3;
    const sc = new THREE.Group(); sc.position.set(s * 0.08, 0.44, 0.2);
    part(sc, G.box, red, 0.17, 0.03, 0.75, 0, 0, 0.4);
    shipBody.add(sc); hero.scarf.push(sc);
  }
  const collar = part(shipBody, G.torus, red, 0.24, 0.24, 1.3, 0, 0.45, 0); collar.rotation.x = Math.PI / 2;
  // 大头、头发、护目镜、脸
  part(shipBody, G.sphere, skin, 0.42, 0.4, 0.42, 0, 0.86, 0);
  part(shipBody, G.sphere, hair, 0.45, 0.36, 0.46, 0, 0.98, 0.04);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const sp = part(shipBody, G.cone, hair, 0.14, 0.42, 0.14, Math.cos(a) * 0.22, 1.3, Math.sin(a) * 0.22 + 0.06);
    sp.rotation.z = -Math.cos(a) * 0.5; sp.rotation.x = Math.sin(a) * 0.5 + 0.25;
  }
  const tuft = part(shipBody, G.cone, hair, 0.16, 0.5, 0.16, 0, 1.36, 0.1); tuft.rotation.x = 0.3;
  const band = part(shipBody, G.torus, darkMat, 0.43, 0.43, 0.9, 0, 0.98, 0); band.rotation.x = Math.PI / 2;
  for (const s of [-1, 1]) {
    part(shipBody, G.sphere, glowMat.cyan, 0.13, 0.1, 0.06, s * 0.16, 1.02, -0.4);
    part(shipBody, G.sphere, skin, 0.09, 0.11, 0.07, s * 0.42, 0.84, 0);
    part(shipBody, G.sphere, armor, 0.085, 0.1, 0.05, s * 0.15, 0.84, -0.38);
    part(shipBody, G.sphere, darkMat, 0.045, 0.06, 0.03, s * 0.15, 0.83, -0.42);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 14, Math.PI), darkMat);
  smile.position.set(0, 0.72, -0.4); smile.rotation.z = Math.PI; shipBody.add(smile);
  // 双手握枪
  hero.gunMount.position.set(0.74, 0.2, -0.55);
  hero.gunMount.rotation.set(0.36, -0.2, 0);
  shipBody.add(hero.gunMount);
  limb(shipBody, suit, 0.1, 0.42, 0.28, 0, 0.72, 0.12, -0.42);
  limb(shipBody, suit, 0.1, -0.42, 0.28, 0, -0.85, 0.05, 0.25);
  part(shipBody, G.sphere, skin, 0.12, 0.12, 0.12, 0.74, 0.08, -0.5);
  part(shipBody, G.sphere, skin, 0.12, 0.12, 0.12, -0.9, 0.02, 0.3);
}

// 激光枪：5 个等级，每一级外形、颜色、火力都不一样
const rainbow = new THREE.Color(1.6, 0.4, 0.4);
const rainbowMat = new THREE.MeshBasicMaterial({ color: rainbow });
const GUNS = [
  { name: '小激光枪', col: C.cyan, rate: 0.16 },
  { name: '双管激光枪', col: C.green, rate: 0.15 },
  { name: '三管散射炮', col: C.gold, rate: 0.14 },
  { name: '雷电加特林', col: C.purple, rate: 0.105 },
  { name: '彩虹毁灭炮', col: rainbow, rate: 0.11 },
];
const gunCol = () => GUNS[P.level - 1].col;
function buildGun(lv) {
  const g = new THREE.Group();
  const glow = lv === 5 ? rainbowMat : [glowMat.cyan, glowMat.green, glowMat.gold, glowMat.purple][lv - 1];
  const white = std(0xd5dcf0), accent = std([0x1c5cff, 0x18b860, 0xffb21a, 0x8a3cff, 0xff3c8a][lv - 1]);
  white.roughness = 0.18;
  const barrel = (parent, x, y, len, r, z0 = -0.4) => {
    const b = part(parent, G.cyl, darkMat, r, len, r, x, y, z0 - len / 2); b.rotation.x = Math.PI / 2;
    part(parent, G.torus, glow, r * 1.5, r * 1.5, r * 5, x, y, z0 - len);
    part(parent, G.sphere, glow, r * 0.8, r * 0.8, r * 0.5, x, y, z0 - len);
  };
  const grip = part(g, G.box, darkMat, 0.11, 0.3, 0.13, 0, -0.2, 0.08); grip.rotation.x = -0.25;
  g.userData.spin = []; g.userData.muzzle = 1.2;
  if (lv === 1) {
    part(g, G.box, white, 0.2, 0.26, 0.75, 0, 0.02, -0.15);
    part(g, G.box, accent, 0.21, 0.08, 0.5, 0, -0.06, -0.15);
    part(g, G.sphere, glow, 0.08, 0.08, 0.22, 0, 0.18, -0.1);
    barrel(g, 0, 0.03, 0.6, 0.06);
    g.userData.muzzle = 1.05;
  } else if (lv === 2) {
    part(g, G.box, white, 0.36, 0.28, 0.9, 0, 0.02, -0.2);
    part(g, G.box, accent, 0.38, 0.09, 0.6, 0, -0.07, -0.2);
    for (const s of [-1, 1]) { barrel(g, s * 0.1, 0.03, 0.8, 0.06, -0.55); part(g, G.box, glow, 0.02, 0.05, 0.6, s * 0.185, 0.06, -0.2); }
    const scope = part(g, G.cyl, darkMat, 0.06, 0.45, 0.06, 0, 0.24, -0.25); scope.rotation.x = Math.PI / 2;
    part(g, G.sphere, glow, 0.055, 0.055, 0.03, 0, 0.24, -0.48);
    part(g, G.box, darkMat, 0.16, 0.18, 0.4, 0, 0, 0.42);
    g.userData.muzzle = 1.4;
  } else if (lv === 3) {
    part(g, G.box, white, 0.42, 0.38, 1.0, 0, 0.03, -0.2);
    part(g, G.box, accent, 0.44, 0.12, 0.8, 0, 0.03, -0.2);
    barrel(g, 0, 0.16, 1.1, 0.065, -0.6); barrel(g, -0.13, -0.05, 1.1, 0.065, -0.6); barrel(g, 0.13, -0.05, 1.1, 0.065, -0.6);
    for (const z of [-0.95, -1.25, -1.55]) part(g, G.torus, glow, 0.27, 0.27, 0.5, 0, 0.04, z);
    for (const s of [-1, 1]) { const f = part(g, G.box, accent, 0.36, 0.04, 0.5, s * 0.34, 0.05, 0.05); f.rotation.y = s * 0.5; f.rotation.z = s * 0.3; }
    part(g, G.sphere, glow, 0.13, 0.13, 0.26, 0, 0.27, -0.1);
    part(g, G.box, darkMat, 0.18, 0.2, 0.45, 0, 0, 0.5);
    g.userData.muzzle = 1.75;
  } else if (lv === 4) {
    const drum = part(g, G.cyl, white, 0.3, 0.8, 0.3, 0, 0.05, -0.2); drum.rotation.x = Math.PI / 2;
    const dr2 = part(g, G.cyl, accent, 0.32, 0.25, 0.32, 0, 0.05, -0.2); dr2.rotation.x = Math.PI / 2;
    const rot = new THREE.Group(); rot.position.set(0, 0.05, 0); g.add(rot);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; barrel(rot, Math.cos(a) * 0.17, Math.sin(a) * 0.17, 1.25, 0.05, -0.6); }
    for (const z of [-0.75, -1.3, -1.8]) { const d = part(rot, G.cyl, darkMat, 0.27, 0.06, 0.27, 0, 0, z); d.rotation.x = Math.PI / 2; }
    part(rot, G.torus, glow, 0.3, 0.3, 0.6, 0, 0, -1.85);
    g.userData.spin.push([rot, 'z', 14]);
    for (const s of [-1, 1]) { part(g, G.sphere, glow, 0.15, 0.15, 0.3, s * 0.36, 0.05, -0.1); part(g, G.box, darkMat, 0.1, 0.06, 0.5, s * 0.34, 0.05, -0.1); }
    const h = part(g, G.torus, darkMat, 0.14, 0.14, 0.8, 0, 0.38, -0.2); h.rotation.y = Math.PI / 2;
    part(g, G.box, darkMat, 0.2, 0.22, 0.5, 0, 0, 0.5);
    g.userData.muzzle = 2.0;
  } else {
    part(g, G.box, white, 0.5, 0.46, 1.1, 0, 0.05, -0.15);
    part(g, G.box, accent, 0.52, 0.14, 0.9, 0, 0.05, -0.15);
    const main = part(g, G.cyl, white, 0.2, 1.5, 0.2, 0, 0.05, -1.4); main.rotation.x = Math.PI / 2;
    const core = part(g, G.cyl, glow, 0.11, 1.75, 0.11, 0, 0.05, -1.45); core.rotation.x = Math.PI / 2;
    [[-1.0, 0.44], [-1.5, 0.38], [-2.0, 0.32]].forEach(([z, r], i) => {
      const ring = new THREE.Group(); ring.position.set(0, 0.05, z); g.add(ring);
      part(ring, G.torus, glow, r, r, 0.6);
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; part(ring, G.box, white, 0.08, 0.08, 0.14, Math.cos(a) * r, Math.sin(a) * r, 0); }
      g.userData.spin.push([ring, 'z', (i % 2 ? -1 : 1) * (3 + i * 1.5)]);
    });
    const cr = part(g, G.oct, glow, 0.16, 0.24, 0.16, 0, 0.5, -0.15); g.userData.spin.push([cr, 'y', 4]);
    for (const s of [-1, 1]) {
      const w = part(g, G.box, glow, 0.8, 0.025, 0.12, s * 0.62, 0.14, 0.1); w.rotation.y = s * 0.6; w.rotation.z = s * 0.3;
      const w2 = part(g, G.box, glow, 0.5, 0.025, 0.09, s * 0.5, -0.08, 0.25); w2.rotation.y = s * 0.7; w2.rotation.z = s * -0.2;
      part(g, G.sphere, glow, 0.1, 0.1, 0.1, s * 0.3, 0.05, 0.42);
    }
    part(g, G.box, darkMat, 0.22, 0.24, 0.5, 0, 0, 0.55);
    g.userData.muzzle = 2.4;
  }
  g.scale.setScalar([1.35, 1.45, 1.55, 1.65, 1.8][lv - 1]);
  return g;
}
function setGun(lv, announce) {
  P.level = lv;
  if (hero.gun) hero.gunMount.remove(hero.gun);
  hero.gun = buildGun(lv); hero.gunMount.add(hero.gun);
  $('gunName').textContent = GUNS[lv - 1].name;
  $('gunPips').innerHTML = [1, 2, 3, 4, 5].map((i) => `<i class="${i <= lv ? 'on' : ''}"></i>`).join('');
  $('weapon').dataset.lv = lv;
  if (!announce) return;
  hero.pop = 1; sfx.power();
  banner(GUNS[lv - 1].name, '⚡ 武器升级！', false);
  const c = GUNS[lv - 1].col;
  shockwave(P.x, P.y, 0, c, 12, 0.5); shockwave(P.x, P.y, 0, C.white, 7, 0.35);
  fireball(P.x + 0.7, P.y, -1.5, c, 3, 0.4);
  for (let i = 0; i < 40; i++) { const a = Math.random() * 6.28, sp = rand(6, 20); spark(P.x + 0.7, P.y, -1, Math.cos(a) * sp, Math.sin(a) * sp, rand(-6, 6), c.r, c.g, c.b, rand(0.4, 0.9), rand(0.4, 0.8), 2); }
}

// 飞船在地面上投下的光晕
const shipGlow = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'varying vec2 vUv; void main(){ float a = smoothstep(0.5, 0.0, distance(vUv, vec2(0.5))); gl_FragColor = vec4(vec3(0.1, 0.6, 1.0), a * a * 0.6); }',
}));
shipGlow.rotation.x = -Math.PI / 2; shipGlow.renderOrder = 1;
scene.add(shipGlow);
const flames = [];
for (const s of [-1, 1]) {
  const f = part(shipBody, G.cone, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1.5, 3), transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }), 0.12, 0.8, 0.12, s * 0.26, -1.08, 2.1);
  f.rotation.x = Math.PI / 2; flames.push(f);
}
const shieldMesh = part(ship, G.sphere, new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.9, 1.8), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }), 2.8, 3.2, 3.2, 0, 0.1, -0.4);
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
const boltMat = (col, core) => {
  const m = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: col }, uCore: { value: core } },
    vertexShader: `
      varying vec3 vN; varying vec3 vV; varying vec3 vIC;
      void main(){ vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        #ifdef USE_INSTANCING_COLOR
          vIC = instanceColor;
        #else
          vIC = vec3(1.0);
        #endif
        vN = normalMatrix * mat3(instanceMatrix) * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `
      uniform vec3 uCol; uniform float uCore; varying vec3 vN; varying vec3 vV; varying vec3 vIC;
      void main(){ float f = abs(dot(normalize(vN), normalize(vV)));
        gl_FragColor = vec4(mix(uCol * vIC, vec3(uCore), pow(f, 2.5)), 1.0); }`,
  });
  m.color = col; // 方便直接改颜色
  return m;
};
const pbGeo = new THREE.CapsuleGeometry(0.11, 2.2, 4, 10); pbGeo.rotateX(Math.PI / 2);
const pbMesh = new THREE.InstancedMesh(pbGeo, boltMat(new THREE.Color(1, 1, 1), 2.2), PB_MAX);
pbMesh.setColorAt(0, C.cyan);
const ebMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 20, 14), boltMat(C.pink.clone(), 2.4), EB_MAX);
pbMesh.frustumCulled = ebMesh.frustumCulled = false; pbMesh.count = ebMesh.count = 0;
scene.add(pbMesh, ebMesh);
const pBullets = [], eBullets = [];
const m4 = new THREE.Matrix4(), q0 = new THREE.Quaternion(), v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
const FWD = new THREE.Vector3(0, 0, -1);

// ---------------------------------------------------------------- 游戏状态
let state = 'menu'; // menu | play | pause | over
let score = 0, best = 0, wave = 0, combo = 0, comboT = 0, time = 0, timeScale = 1, slowT = 0;
try { best = parseInt(localStorage.getItem('gw_best') || '0', 10) || 0; } catch (e) { /* ignore */ }
const P = { x: 0, y: 5, tx: 0, ty: 5, lives: 3, shield: false, inv: 0, level: 1, bombs: 2, fireT: 0, alive: true, deadT: 0, superT: 0 };
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
    for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; part(g, G.sphere, i % 2 ? glowMat.gold : glowMat.cyan, 0.13, 0.13, 0.13, Math.cos(a) * 1.35, -0.12, Math.sin(a) * 1.35); }
    part(g, G.sphere, darkMat, 1.0, 0.3, 1.0, 0, -0.25, 0);
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
  const hpMul = type === 'boss' ? 1 + (wave / 5 - 1) * 0.6 : 1 + wave * 0.2;
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
    const pool = ['P', 'S', 'B'];
    if (P.lives < 4) pool.push('H', 'H');
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
    if (P.level < 5) setGun(P.level + 1, true);
    else { P.superT = 8; addScore(500, P.x, P.y, 0, true); sfx.power(); banner('超级火力', '⚡ 8 秒钟火力全开！', false); }
  } else if (p.kind === 'S') { P.shield = true; sfx.shield(); }
  else if (p.kind === 'B') { P.bombs = Math.min(5, P.bombs + 1); sfx.pickup(); }
  else { P.lives = Math.min(5, P.lives + 1); sfx.pickup(); }
  if (p.kind !== 'P') popText(P.x, P.y + 2, 0, d.text, 'gold');
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

const hsl = new THREE.Color();
function fire() {
  target = findTarget();
  const n = P.level, sup = P.superT > 0;
  const ml = hero.gun.userData.muzzle * hero.gun.scale.x;
  const mx = P.x + (0.74 + ml * 0.19) * HERO_K, my = P.y + (0.22 + ml * 0.35) * HERO_K, mz = -(0.55 + ml * 0.92) * HERO_K;
  for (let i = 0; i < n; i++) {
    if (pBullets.length >= PB_MAX) break;
    const o = i - (n - 1) / 2;
    const b = { x: mx + o * 0.1, y: my, z: mz, vx: 0, vy: 0, vz: -1, q: new THREE.Quaternion(), c: new THREE.Color(), s: sup ? 1.6 : 1 };
    if (n === 5) b.c.setHSL((time * 0.9 + i * 0.2) % 1, 1, 0.55).multiplyScalar(1.7); else b.c.copy(gunCol());
    if (target) {
      const lead = Math.abs(target.z) / 170;
      v0.set(target.x + (target.x - (target.px ?? target.x)) / Math.max(lastDt, 0.001) * lead + o * 0.7 - b.x, target.y - b.y, target.z - b.z).normalize();
    } else v0.set(o * 0.05, 0, -1).normalize();
    b.vx = v0.x * 170; b.vy = v0.y * 170; b.vz = v0.z * 170;
    b.q.setFromUnitVectors(FWD, v0);
    pBullets.push(b);
  }
  const c = gunCol();
  spark(mx, my, mz - 0.3, 0, 0, -8, c.r * 0.7, c.g * 0.7, c.b * 0.7, 1.0 + n * 0.25, 0.06, 0);
  hero.recoil = 1;
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
  shipBody.rotation.z += (clamp(-vx * 0.035, -0.55, 0.55) - shipBody.rotation.z) * Math.min(1, dt * 10);
  shipBody.rotation.x += (clamp(vy * 0.03, -0.4, 0.4) - shipBody.rotation.x) * Math.min(1, dt * 10);
  shipBody.rotation.y = shipBody.rotation.z * -0.3;
  shipBody.position.y = Math.sin(time * 3) * 0.08;
  for (const f of flames) f.scale.y = 0.6 + Math.random() * 0.4;
  hero.scarf.forEach((sc, i) => { sc.rotation.x = -0.25 + Math.sin(time * 9 + i * 1.3) * 0.2; sc.rotation.y = Math.sin(time * 6 + i * 2) * 0.25 + shipBody.rotation.z * 0.8; });
  rainbow.setHSL((time * 0.5) % 1, 1, 0.5).multiplyScalar(1.8);
  hero.pop = Math.max(0, hero.pop - dt * 2.2); hero.recoil = Math.max(0, hero.recoil - dt * 12);
  hero.gunMount.scale.setScalar(1 + Math.sin(hero.pop * Math.PI) * 0.9);
  hero.gunMount.position.z = -0.55 + hero.recoil * 0.07;
  hero.gunMount.rotation.z = hero.pop * hero.pop * Math.PI * 2;
  hero.gunMount.rotation.x = 0.36 + hero.recoil * 0.05;
  if (hero.gun) for (const [m, ax, sp] of hero.gun.userData.spin) m.rotation[ax] += sp * dt;
  P.superT = Math.max(0, P.superT - dt);
  shipGlow.position.set(P.x, 0.08, 0.4); shipGlow.scale.setScalar(2.5 + P.y * 0.35); shipGlow.visible = true;
  for (const s of [-0.34, 0.34]) spark(P.x + s * 1.2, P.y - 1.08 * HERO_K, 1.8 * HERO_K, rand(-0.5, 0.5), rand(-0.5, 0.5), 22, 0.12, 0.45, 1.0, 0.4, 0.22, 0);

  P.inv = Math.max(0, P.inv - dt);
  ship.visible = P.inv <= 0 || Math.floor(P.inv * 14) % 2 === 0;
  shieldMesh.visible = P.shield;
  if (P.shield) { shieldMesh.material.opacity = 0.09 + 0.04 * Math.sin(time * 8); shieldMesh.rotation.y += dt * 2; }

  P.fireT -= dt;
  if (P.fireT <= 0) { P.fireT = GUNS[P.level - 1].rate * (P.superT > 0 ? 0.55 : 1); fire(); }
}

function hurtPlayer() {
  if (!P.alive || P.inv > 0 || state !== 'play') return;
  if (P.shield) {
    P.shield = false; P.inv = 1; sfx.shield(); shake(0.4);
    shockwave(P.x, P.y, 0, C.cyan, 9, 0.4); popText(P.x, P.y + 1.5, 0, '护盾挡住了！');
    return;
  }
  P.lives--; P.inv = 2.2; combo = 0; P.superT = 0;
  flash('red'); shake(0.8); sfx.hurt();
  if (navigator.vibrate) navigator.vibrate(120);
  explode(P.x, P.y, 0, C.orange, 0.8, true);
  eBullets.length = 0;
  if (P.lives <= 0) {
    P.alive = false; P.deadT = 1.4; ship.visible = false; shipGlow.visible = false; shieldMesh.visible = false; reticle.visible = false;
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
          const c = b.c;
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
  for (const b of pBullets) { v0.set(b.x, b.y, b.z); v1.set(b.s, b.s, 1); m4.compose(v0, b.q, v1); pbMesh.setMatrixAt(n, m4); pbMesh.setColorAt(n++, b.c); }
  pbMesh.count = n; pbMesh.instanceMatrix.needsUpdate = true; pbMesh.instanceColor.needsUpdate = true;
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
    if (wave > 0) { addScore(wave * 200, P.x, P.y + 2, 0, true); if (wave % 5) dropPickup(rand(-1, 1) * field.x * 0.6, field.yc, -70, wave % 2 === 0 ? 'P' : pick(['S', 'B', P.lives < 4 ? 'H' : 'S'])); }
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
  Object.assign(P, { x: 0, y: field.yc, tx: 0, ty: field.yc, lives: 4, shield: false, inv: 1.5, level: 1, bombs: 2, fireT: 0.3, alive: true, superT: 0 });
  setGun(1, false);
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
  floorMat.uniforms.uOff.value = (floorMat.uniforms.uOff.value + WORLD_SPEED * dt) % 100000;
  floorPulse = Math.max(0, floorPulse - dt * 1.5); floorMat.uniforms.uPulse.value = floorPulse * 2;
  sun.material.uniforms.uT.value = time;
  planet.rotation.y += dt * 0.02;
  starMat.uniforms.uT.value = time;
  if (Math.random() < dt * 45) spark(camPos.x + rand(-34, 34), rand(0.5, 20), -170, 0, 0, 170, 0.5, 0.75, 1.3, 0.32, 0.9, 0, 0);
  for (let i = 0; i < PYL_N; i++) {
    const p = pylData[i]; p.z += WORLD_SPEED * dt;
    if (p.z > 20) { p.z -= PYL_N * 8; p.h = rand(8, 34); }
    v0.set(p.x, p.h / 2, p.z); v1.set(p.w, p.h, p.w); q0.identity(); m4.compose(v0, q0, v1); pylons.setMatrixAt(i, m4);
  }
  pylons.instanceMatrix.needsUpdate = true;
  for (const g of gates) { g.position.z += WORLD_SPEED * dt; if (g.position.z > 20) g.position.z -= 320; }
}

function updateCamera(rdt) {
  const fx = P.x, fy = P.y - field.yc;
  const land = viewW > viewH;
  if (state === 'menu') v0.set(P.x + (land ? 2.5 : 2), P.y + 0.8, land ? -10.5 : -13.5); else v0.set(fx * 0.74 + 1.0, field.yc + fy * 0.9 + 3.8, CAM_DIST);
  camPos.lerp(v0, Math.min(1, rdt * 7));
  camLook.lerp(state === 'menu' ? v1.set(P.x - (land ? 2.2 : 0), P.y + (land ? -0.2 : 6.2), 0) : v1.set(fx * 0.82 + 0.4, field.yc + fy * 0.92 - 3.0, -30), Math.min(1, rdt * 7));
  trauma = Math.max(0, trauma - rdt * 1.6);
  lensPass.uniforms.uAb.value = 0.012 + trauma * trauma * 0.14;
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
    P.tx = Math.sin(time * 0.7) * 0.8; P.ty = field.yc + Math.sin(time * 1.1) * 0.4;
    updatePlayer(dt); updateBullets(dt);
  } else {
    for (const e of enemies) e.px = e.x;
    updatePlayer(dt); updateWaves(dt); updateEnemies(dt); updateBullets(dt); updatePickups(dt);
    if (comboT > 0) { comboT -= dt; if (comboT <= 0) { combo = 0; $('combo').classList.remove('on'); } }
    if (!P.alive && state === 'play') { P.deadT -= rdt; if (P.deadT <= 0) gameOver(); }
  }
  lastDt = dt;
  updateParticles(dt); updateFx(dt); updateCamera(rdt); updateRings(dt); updateReticle(dt);

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
setGun(1, false);
requestAnimationFrame(frame);

if (params.has('debug')) window.__game = { P, enemies, eBullets, get state() { return state; }, get wave() { return wave; }, get score() { return score; }, get quality() { return quality; }, startWave, useBomb, hurtPlayer, dropPickup, spawnEnemy, setGun };
