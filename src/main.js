import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import {
  FPS, DURATION, START_S, LANE, ROAD_W, END_S, path, pathAt, rightOf, fwdOf, distAt,
  carState, shotAt, fadeAlpha, stageAt, sm, clamp, lerp,
} from './timeline.js';
import { createHud } from './hud.js';
import { makePlume, makeDust } from './fx.js';

const q = new URLSearchParams(location.search);
const BLOOM = q.get('bloom') !== '0';
const MSAA = q.get('msaa') !== '0';
const W = 1920,
  H = 1080;
const DPR = window.devicePixelRatio || 1;

// deterministic RNG (never Math.random – every render shard must build the same world)
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: !BLOOM && MSAA, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(DPR);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, W / H, 0.1, 9000);
scene.fog = new THREE.FogExp2(0x000000, 0.0002);

let composer, bloom;
if (BLOOM) {
  const rt = new THREE.WebGLRenderTarget(W * DPR, H * DPR, { type: THREE.HalfFloatType, samples: MSAA ? 4 : 0 });
  composer = new EffectComposer(renderer, rt);
  composer.setPixelRatio(DPR);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  // clamp absurd HDR values (the sun disc) so bloom doesn't wash the whole frame
  composer.addPass(new ShaderPass({ uniforms: { tDiffuse: { value: null } }, vertexShader: 'varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}', fragmentShader: 'uniform sampler2D tDiffuse;varying vec2 vUv;void main(){vec4 c=texture2D(tDiffuse,vUv);gl_FragColor=vec4(min(c.rgb,vec3(6.0)),c.a);}' }));
  bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.3, 0.35, 1.0);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}

const hud = createHud();
const pmrem = new THREE.PMREMGenerator(renderer);

// ------------------------------------------------------------------ assets
const manifest = await fetch(q.get('manifest') || '/assets/manifest.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
const texLoader = new THREE.TextureLoader();
const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
const loadTex = (url, srgb) =>
  new Promise((res) =>
    texLoader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        res(t);
      },
      undefined,
      () => res(null),
    ),
  );

function noiseTex(size, base, vari, seed, { blotch = 0.12, dots = 60000, tint = [0, 0, 0] } = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const r = rng(seed);
  g.fillStyle = `rgb(${base},${base},${base})`;
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const v = base + (r() - 0.5) * vari * 2 * 1.5;
    g.fillStyle = `rgba(${v + tint[0]},${v + tint[1]},${v + tint[2]},${blotch})`;
    g.beginPath();
    g.arc(r() * size, r() * size, 10 + r() * 60, 0, 7);
    g.fill();
  }
  for (let i = 0; i < dots; i++) {
    const v = base + (r() - 0.5) * vari * 2;
    g.fillStyle = `rgb(${v + tint[0]},${v + tint[1]},${v + tint[2]})`;
    g.fillRect(r() * size, r() * size, 1 + r() * 2, 1 + r() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

// PBR material from a Poly Haven style set {diff,nor,rough}, with a procedural fallback
async function pbr(name, fallback, repeat) {
  const set = manifest[name];
  const m = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, envMapIntensity: 0.35 });
  if (set && set.diff) {
    const [d, n, r] = await Promise.all([loadTex(set.diff, true), set.nor ? loadTex(set.nor, false) : null, set.rough ? loadTex(set.rough, false) : null]);
    if (d) {
      m.map = d;
      if (n) m.normalMap = n;
      if (r) (m.roughnessMap = r), (m.roughness = 1);
      m.userData.real = true;
    }
  }
  if (!m.map) {
    m.map = fallback();
    m.bumpMap = m.map;
    m.bumpScale = 1.5;
  }
  return m;
}

const asphaltMat = await pbr('asphalt', () => noiseTex(1024, 62, 12, 11, { blotch: 0.12 }));
const groundMat = await pbr('ground', () => noiseTex(1024, 128, 40, 22, { blotch: 0.2, tint: [24, 10, -22] }));
const concreteMat = await pbr('concrete', () => noiseTex(512, 150, 24, 33, { blotch: 0.2 }));
const rockMat = await pbr('rock', () => noiseTex(512, 110, 38, 44, { blotch: 0.25, tint: [10, 4, -10] }));
console.log('textures real:', { asphalt: !!asphaltMat.userData.real, ground: !!groundMat.userData.real, concrete: !!concreteMat.userData.real, rock: !!rockMat.userData.real });
const setRepeat = (mat, rx, ry) => {
  for (const k of ['map', 'normalMap', 'roughnessMap', 'bumpMap']) if (mat[k]) (mat[k] = mat[k]), mat[k].repeat.set(rx, ry);
};

// ------------------------------------------------------------------ environments
async function hdriEnv(url, fallbackSun) {
  if (url) {
    try {
      const tex = await new RGBELoader().loadAsync(url);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      const env = pmrem.fromEquirectangular(tex).texture;
      return { bg: tex, env, real: true };
    } catch (e) {
      console.warn('HDRI failed', url, e);
    }
  }
  const sc = new THREE.Scene();
  const sky = new Sky();
  sky.scale.setScalar(1000);
  const u = sky.material.uniforms;
  u.turbidity.value = fallbackSun.turb;
  u.rayleigh.value = fallbackSun.ray;
  u.mieCoefficient.value = 0.005;
  u.mieDirectionalG.value = 0.8;
  const el = THREE.MathUtils.degToRad(90 - fallbackSun.elev),
    az = THREE.MathUtils.degToRad(fallbackSun.az);
  u.sunPosition.value.setFromSphericalCoords(1, el, az);
  sc.add(sky);
  const env = pmrem.fromScene(sc, 0, 0.1, 2000).texture;
  return { bg: env, env, real: false };
}
const dayEnv = await hdriEnv(manifest.hdri && manifest.hdri.day, { elev: 38, az: 150, turb: 3, ray: 1.2 });
const duskEnv = await hdriEnv(manifest.hdri && manifest.hdri.dusk, { elev: 4, az: 150, turb: 6, ray: 2.4 });
const studioEnv = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
console.log('hdri real:', dayEnv.real, duskEnv.real);

// ------------------------------------------------------------------ world
const world = new THREE.Group();
scene.add(world);
const S_MAX = END_S + 2200;

function ribbon(width, y, offset, uScale, vScale, s0, s1, step = 4) {
  const pos = [],
    uv = [],
    idx = [];
  let n = 0;
  for (let s = s0; s <= s1 + 1e-6; s += step) {
    const p = pathAt(s),
      r = rightOf(p.th);
    for (const side of [-1, 1]) {
      const lat = offset + (side * width) / 2;
      pos.push(p.x + r[0] * lat, y, p.z + r[2] * lat);
      uv.push((side + 1) * 0.5 * uScale, s / vScale);
    }
    if (n > 0) {
      const a = (n - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    n++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3 * 3).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setIndex(idx);
  return g;
}

// road surface (texture tile ≈ 6 m)
setRepeat(asphaltMat, 1, 1);
const road = new THREE.Mesh(ribbon(ROAD_W, 0, 0, ROAD_W / 6, 6, 0, S_MAX), asphaltMat);
road.receiveShadow = true;
world.add(road);

// lane markings + rubber streaks
function markingTex() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 1024;
  const g = c.getContext('2d');
  const px = (m) => (m / ROAD_W) * 512;
  g.fillStyle = '#f2f2ee';
  g.fillRect(px(0.45), 0, px(0.16), 1024); // left edge line
  g.fillRect(px(ROAD_W - 0.61), 0, px(0.16), 1024); // right edge line
  g.fillStyle = '#e9d9a0';
  g.fillRect(px(ROAD_W / 2 - 0.08), 0, px(0.16), 341); // dashed centre line
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
const marks = new THREE.Mesh(
  ribbon(ROAD_W, 0.012, 0, 1, 12, 0, S_MAX),
  new THREE.MeshStandardMaterial({ map: markingTex(), transparent: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }),
);
marks.receiveShadow = true;
world.add(marks);

function rubberTex() {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const r = rng(5);
  const px = (m) => (m / ROAD_W) * 512;
  for (const dz of [-0.8, 0.8]) {
    const cx = px(ROAD_W / 2 + LANE + dz);
    for (let i = 0; i < 1400; i++) {
      g.fillStyle = `rgba(8,8,9,${0.05 + r() * 0.12})`;
      g.fillRect(cx - px(0.16) + r() * px(0.32), r() * 512, 1 + r() * 3, 2 + r() * 14);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const rubber = new THREE.Mesh(
  ribbon(ROAD_W, 0.014, 0, 1, 60, START_S - 20, START_S + 240, 4),
  new THREE.MeshStandardMaterial({ map: rubberTex(), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, depthWrite: false }),
);
world.add(rubber);

// start line (chequered band)
{
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 64; i++)
    for (let j = 0; j < 4; j++) {
      g.fillStyle = (i + j) % 2 ? '#f4f4f4' : '#151515';
      g.fillRect(i * 8, j * 8, 8, 8);
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const p = pathAt(START_S + 2.9);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W - 1, 0.6), new THREE.MeshStandardMaterial({ map: t, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  m.rotation.set(-Math.PI / 2, 0, 0);
  m.rotation.order = 'YXZ';
  m.rotation.y = p.th + Math.PI / 2;
  m.position.set(p.x, 0.02, p.z);
  m.receiveShadow = true;
  world.add(m);
}

// ground (re-centres under the camera)
setRepeat(groundMat, 1, 1);
for (const k of ['map', 'normalMap', 'roughnessMap', 'bumpMap']) if (groundMat[k]) groundMat[k].repeat.set(900, 900);
const GROUND = 9000;
const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND, GROUND), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.06;
ground.receiveShadow = true;
scene.add(ground);
const GRID = GROUND / 900; // metres per texture tile

// barriers (instanced jersey barriers)
const dummy = new THREE.Object3D();
{
  setRepeat(concreteMat, 1, 1);
  const geo = new THREE.BoxGeometry(6.05, 0.9, 0.5);
  geo.translate(0, 0.45, 0);
  const cnt = Math.floor(S_MAX / 6) * 2;
  const im = new THREE.InstancedMesh(geo, concreteMat, cnt);
  let i = 0;
  for (let s = 3; s < S_MAX - 3 && i < cnt - 1; s += 6)
    for (const side of [-1, 1]) {
      const p = pathAt(s),
        r = rightOf(p.th),
        lat = side * (ROAD_W / 2 + 1.4);
      dummy.position.set(p.x + r[0] * lat, 0, p.z + r[2] * lat);
      dummy.rotation.set(0, p.th, 0);
      dummy.updateMatrix();
      im.setMatrixAt(i++, dummy.matrix);
    }
  im.count = i;
  im.receiveShadow = true;
  world.add(im);
}

// light poles
const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2b0, emissiveIntensity: 0.0 });
{
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a8f95, metalness: 0.8, roughness: 0.45 });
  const pg = new THREE.CylinderGeometry(0.1, 0.16, 10, 8);
  pg.translate(0, 5, 0);
  const ag = new THREE.BoxGeometry(3.2, 0.12, 0.18);
  ag.translate(-1.5, 10, 0);
  const lg = new THREE.BoxGeometry(0.9, 0.12, 0.35);
  lg.translate(-2.9, 9.9, 0);
  const n = Math.floor(S_MAX / 70);
  const a = new THREE.InstancedMesh(pg, poleMat, n),
    b = new THREE.InstancedMesh(ag, poleMat, n),
    c = new THREE.InstancedMesh(lg, lampMat, n);
  let i = 0;
  for (let s = 35; s < S_MAX && i < n; s += 70) {
    const p = pathAt(s),
      r = rightOf(p.th),
      lat = ROAD_W / 2 + 3;
    dummy.position.set(p.x + r[0] * lat, 0, p.z + r[2] * lat);
    dummy.rotation.set(0, p.th, 0);
    dummy.updateMatrix();
    for (const m of [a, b, c]) m.setMatrixAt(i, dummy.matrix);
    i++;
  }
  for (const m of [a, b, c]) (m.count = i), world.add(m);
}

// scattered rocks (real rock texture) for parallax
{
  const g = new THREE.IcosahedronGeometry(1, 2);
  const r = rng(77);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const n = 0.75 + 0.5 * Math.abs(Math.sin(x * 3.1 + y * 2.3) * Math.cos(z * 2.7 + x * 1.1));
    p.setXYZ(i, x * n, y * n * 0.7, z * n);
  }
  g.computeVertexNormals();
  setRepeat(rockMat, 2, 2);
  const n = 2200;
  const im = new THREE.InstancedMesh(g, rockMat, n);
  for (let i = 0; i < n; i++) {
    const s = r() * S_MAX;
    const side = r() < 0.5 ? -1 : 1;
    const lat = side * (ROAD_W / 2 + 14 + Math.pow(r(), 1.6) * 260);
    const pp = pathAt(s),
      rr = rightOf(pp.th);
    const sc = 0.5 + Math.pow(r(), 3) * 7;
    dummy.position.set(pp.x + rr[0] * lat, sc * 0.2, pp.z + rr[2] * lat);
    dummy.rotation.set(r() * 3, r() * 6, r() * 3);
    dummy.scale.set(sc * (0.8 + r() * 0.6), sc * (0.6 + r() * 0.5), sc * (0.8 + r() * 0.6));
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  }
  dummy.scale.set(1, 1, 1);
  im.castShadow = false;
  im.receiveShadow = true;
  world.add(im);
}

// gantry + pit building near the start
{
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa1a8, metalness: 0.85, roughness: 0.4 });
  const sPos = START_S + 70;
  const p = pathAt(sPos),
    r = rightOf(p.th);
  const grp = new THREE.Group();
  grp.position.set(p.x, 0, p.z);
  grp.rotation.y = p.th;
  for (const side of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), steel);
    post.position.set(0, 4, side * (ROAD_W / 2 + 1.2));
    grp.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, ROAD_W + 2.8), steel);
  beam.position.set(0, 8, 0);
  grp.add(beam);
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#0b1118';
  g.fillRect(0, 0, 2048, 256);
  g.fillStyle = '#3fd7ff';
  g.fillRect(0, 0, 2048, 10);
  g.fillRect(0, 246, 2048, 10);
  g.fillStyle = '#ffffff';
  g.font = '700 120px sans-serif';
  g.textAlign = 'center';
  g.fillText('TECHNICAL TALK INDIA', 1024, 130);
  g.fillStyle = '#3fd7ff';
  g.font = '600 56px sans-serif';
  g.fillText('CLOSED TEST COURSE · FICTIONAL', 1024, 214);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W + 2, (ROAD_W + 2) / 8), new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.35, roughness: 0.6 }));
  sign.rotation.y = -Math.PI / 2;
  sign.position.set(-0.4, 6.6, 0);
  grp.add(sign);
  world.add(grp);

  // pit building
  const bp = pathAt(START_S + 30),
    br = rightOf(bp.th);
  const bld = new THREE.Group();
  bld.position.set(bp.x + br[0] * 40, 0, bp.z + br[2] * 40);
  bld.rotation.y = bp.th;
  const body = new THREE.Mesh(new THREE.BoxGeometry(70, 6, 14), concreteMat);
  body.position.y = 3;
  const roof = new THREE.Mesh(new THREE.BoxGeometry(74, 0.5, 18), steel);
  roof.position.y = 6.3;
  const glass = new THREE.Mesh(new THREE.BoxGeometry(60, 2.4, 0.1), new THREE.MeshStandardMaterial({ color: 0x0b1620, metalness: 0.9, roughness: 0.08 }));
  glass.position.set(0, 3, -7.1);
  bld.add(body, roof, glass);
  for (const m of [body, roof]) (m.castShadow = true), (m.receiveShadow = true);
  world.add(bld);
}

// studio floor + tech grid
const studioFloor = new THREE.Mesh(
  new THREE.CircleGeometry(60, 96),
  new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.22, metalness: 0.65, envMapIntensity: 0.9 }),
);
studioFloor.rotation.x = -Math.PI / 2;
studioFloor.position.y = 0.03;
studioFloor.receiveShadow = true;
scene.add(studioFloor);

const techFloor = new THREE.Group();
{
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 1024, 1024);
  g.strokeStyle = '#2aa8d6';
  g.lineWidth = 2;
  for (let i = 0; i <= 16; i++) {
    g.globalAlpha = i % 4 === 0 ? 0.9 : 0.35;
    g.beginPath();
    g.moveTo(i * 64, 0);
    g.lineTo(i * 64, 1024);
    g.moveTo(0, i * 64);
    g.lineTo(1024, i * 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(10, 10);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshBasicMaterial({ map: t, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: true }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.05;
  techFloor.add(m);
}
scene.add(techFloor);

// ------------------------------------------------------------------ lights
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 220 });
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);

const rim1 = new THREE.SpotLight(0x8fb8ff, 0, 60, 0.5, 0.6, 1.2);
const rim2 = new THREE.SpotLight(0xffffff, 0, 60, 0.5, 0.6, 1.2);
scene.add(rim1, rim2, rim1.target, rim2.target);
const thrusterLight = new THREE.PointLight(0x7fb8ff, 0, 40, 1.6);
scene.add(thrusterLight);

// ------------------------------------------------------------------ car
const draco = new DRACOLoader().setDecoderPath('/node_modules/three/examples/jsm/libs/draco/gltf/');
const gltfLoader = new GLTFLoader().setDRACOLoader(draco);
const carUrl = manifest.car || '/assets/models/roadster.glb';
let gltf;
try {
  gltf = await gltfLoader.loadAsync(carUrl);
} catch (e) {
  console.warn('custom car not found, using stand-in', e);
  gltf = await gltfLoader.loadAsync('/assets/models/ferrari.glb');
}
const MODEL_YAW = manifest.carYaw ?? -Math.PI / 2; // rotate the stand-in model so its nose points along +X

function carbonTex() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#101113';
  g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y += 16)
    for (let x = 0; x < 256; x += 16) {
      const a = ((x + y) / 16) % 2 === 0;
      const gr = g.createLinearGradient(x, y, a ? x + 16 : x, a ? y : y + 16);
      gr.addColorStop(0, '#2b2d31');
      gr.addColorStop(1, '#0a0a0b');
      g.fillStyle = gr;
      g.fillRect(x + 1, y + 1, 14, 14);
    }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(6, 6);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}
const carbon = carbonTex();

function prepareModel(scn) {
  scn.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    const m = o.material;
    if (!m) return;
    const n = (m.name || '').toLowerCase();
    m.envMapIntensity = 1.0;
    if (n.includes('body')) {
      Object.assign(m, { color: new THREE.Color(0x7b8087), metalness: 0.85, roughness: 0.36 });
      if ('clearcoat' in m) Object.assign(m, { clearcoat: 1, clearcoatRoughness: 0.03 });
      m.envMapIntensity = 1.5;
    } else if (n.includes('metal_gray') || n === 'metal') {
      Object.assign(m, { color: new THREE.Color(0x5d6168), metalness: 1, roughness: 0.28 });
    } else if (n.includes('carbon')) {
      m.map = carbon;
      m.color = new THREE.Color(0xffffff);
      m.roughness = 0.35;
      m.metalness = 0.4;
    } else if (n.includes('tire') || n.includes('tyre')) {
      m.roughness = 0.88;
      m.metalness = 0;
      m.color = new THREE.Color(0x0c0c0d);
    } else if (n.includes('glass') && !n.includes('taillight') && !n.includes('projector')) {
      m.envMapIntensity = 1.8;
    }
  });
}

const L = 4.5;
const carRoot = new THREE.Group(); // world pose
const carInner = new THREE.Group(); // suspension drop
const carModel = gltf.scene;
prepareModel(carModel);
const holder = new THREE.Group();
holder.rotation.y = MODEL_YAW;
holder.add(carModel);
{
  const wrap = new THREE.Group();
  wrap.add(holder);
  wrap.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(wrap);
  const size = box.getSize(new THREE.Vector3());
  const k = L / size.x;
  wrap.scale.setScalar(k);
  wrap.position.set(-((box.min.x + box.max.x) / 2) * k, -box.min.y * k, -((box.min.z + box.max.z) / 2) * k);
  carInner.add(wrap);
  console.log('car size m:', (size.x * k).toFixed(2), (size.y * k).toFixed(2), (size.z * k).toFixed(2));
}
carRoot.add(carInner);
scene.add(carRoot);
carRoot.updateMatrixWorld(true);

// wheels: spin about the car's lateral axis, brakes stay still
const wheels = [];
for (const nm of ['wheel_fl', 'wheel_fr', 'wheel_rl', 'wheel_rr']) {
  const w = carModel.getObjectByName(nm);
  if (!w) continue;
  const brakes = [];
  w.traverse((c) => c !== w && /^brake/i.test(c.name) && brakes.push(c));
  for (const b of brakes) w.parent.attach(b);
  const qp = new THREE.Quaternion();
  w.parent.getWorldQuaternion(qp);
  wheels.push({ node: w, base: w.quaternion.clone(), axis: new THREE.Vector3(0, 0, 1).applyQuaternion(qp.clone().invert()).normalize(), tmp: new THREE.Quaternion() });
}
console.log('wheels found:', wheels.length);

// lights on the model
const headMats = [],
  tailMats = [];
carModel.traverse((o) => {
  if (!o.isMesh || !o.material) return;
  const n = (o.material.name || '').toLowerCase();
  if (n.includes('projector') || n.includes('turn_signal')) headMats.push(o.material);
  if (n.includes('taillight')) tailMats.push(o.material);
});
const headSpots = [];
for (const z of [-0.62, 0.62]) {
  const s = new THREE.SpotLight(0xfff3dd, 0, 90, 0.42, 0.7, 1.4);
  s.position.set(2.0, 0.66, z);
  s.target.position.set(30, 0.2, z * 1.4);
  carRoot.add(s, s.target);
  headSpots.push(s);
}

// concept thruster pods
const pods = new THREE.Group();
carInner.add(pods);
const podMetal = new THREE.MeshStandardMaterial({ color: 0x3a3e45, metalness: 0.85, roughness: 0.32, envMapIntensity: 1.2 });
const podGlow = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0x66b8ff, emissiveIntensity: 0 });
const nozzleMarkers = [];
const podList = [];
function makePod(x, y, z, dir, r, len) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 1.1, len, 24), podMetal);
  const bell = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.55, r * 0.9, len * 0.45, 24, 1, true), podMetal);
  bell.material = podMetal.clone();
  bell.material.side = THREE.DoubleSide;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(r * 1.2, r * 0.12, 8, 28), podGlow);
  const core = new THREE.Mesh(new THREE.CircleGeometry(r * 1.0, 20), podGlow);
  body.position.y = len * 0.1;
  bell.position.y = -len * 0.55;
  ring.rotation.x = Math.PI / 2;
  ring.position.y = -len * 0.77;
  core.rotation.x = Math.PI / 2;
  core.position.y = -len * 0.74;
  g.add(body, bell, ring, core);
  for (const m of [body, bell]) m.castShadow = true;
  // orient: cylinder axis (y) → exhaust direction (dir, pointing out of the nozzle)
  g.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir.clone().normalize());
  const holderG = new THREE.Group();
  holderG.position.set(x, y, z);
  holderG.add(g);
  const marker = new THREE.Object3D();
  marker.position.copy(dir.clone().normalize().multiplyScalar(len * 0.8));
  holderG.add(marker);
  pods.add(holderG);
  nozzleMarkers.push({ marker, dir: dir.clone().normalize(), kind: dir.y < -0.5 ? 'down' : 'rear' });
  podList.push({ holder: holderG, x, y, z });
}
for (const sx of [1, -1]) for (const sz of [-1, 1]) makePod(0.68 * sx, 0.46, 1.02 * sz, new THREE.Vector3(0, -1, 0), 0.1, 0.3);
for (const sz of [-1, 1]) makePod(-2.15, 0.62, 0.5 * sz, new THREE.Vector3(-1, 0, 0), 0.15, 0.5);

// plumes
const plumes = nozzleMarkers.map((n, i) => {
  const p = n.kind === 'down' ? makePlume(1800, 100 + i, { life: 0.9, speed: 14, size: 0.42, spread: 0.2 }) : makePlume(2200, 200 + i, { life: 0.7, speed: 24, size: 0.55, spread: 0.18 });
  scene.add(p);
  return p;
});
const dust = makeDust(3500, 9);
scene.add(dust);

// parked cars for the fly-over
const parked = new THREE.Group();
{
  const colors = [0xe9e9ea, 0x1b1d20, 0xb2252b, 0x1f3f8c, 0xd9d9dc, 0x2a2d31, 0x8a8d92, 0xf0f0f0];
  const sMid = distAt(332.5);
  const r = rng(3);
  let k = 0;
  for (const lane of [-LANE, LANE])
    for (let i = -3; i <= 2; i++) {
      const s = sMid + i * 6.8 + (r() - 0.5) * 0.6;
      const p = pathAt(s),
        rr = rightOf(p.th);
      const clone = carInner.children[0].clone(true);
      clone.traverse((o) => {
        if (o.isMesh && o.material && (o.material.name || '').toLowerCase().includes('body')) {
          o.material = o.material.clone();
          o.material.color = new THREE.Color(colors[k % colors.length]);
          o.material.metalness = 0.6;
        }
      });
      k++;
      const g = new THREE.Group();
      g.add(clone);
      g.position.set(p.x + rr[0] * lane, 0, p.z + rr[2] * lane);
      g.rotation.y = p.th + (r() - 0.5) * 0.02;
      parked.add(g);
    }
}
scene.add(parked);

// ------------------------------------------------------------------ stage control
const STAGE = {
  studio: { bg: new THREE.Color(0x030304), fog: [0x030304, 0.046], env: studioEnv, envI: 0.22, exp: 0.9, bloom: 0.25 },
  tech: { bg: new THREE.Color(0x02060a), fog: [0x02060a, 0.04], env: studioEnv, envI: 0.2, exp: 0.9, bloom: 0.45 },
  track: { bg: null, fog: [0x9db8d6, 0.00022], env: dayEnv.env, envI: dayEnv.real ? 1 : 0.3, bgI: dayEnv.real ? 1 : 0.22, exp: 0.9, bloom: 0.15 },
  dusk: { bg: null, fog: [0x6b5a66, 0.00045], env: duskEnv.env, envI: duskEnv.real ? 1 : 0.4, bgI: duskEnv.real ? 1 : 0.3, exp: 0.95, bloom: 0.5 },
};
function applyStage(name, t, car) {
  const s = STAGE[name];
  const sc = scene;
  sc.environment = s.env;
  sc.environmentIntensity = s.envI;
  if (s.bg) sc.background = s.bg;
  else {
    sc.background = (name === 'dusk' ? duskEnv : dayEnv).bg;
    sc.backgroundIntensity = s.bgI ?? 1;
    sc.backgroundBlurriness = 0;
  }
  sc.fog.color.set(s.fog[0]);
  sc.fog.density = s.fog[1];
  renderer.toneMappingExposure = s.exp;
  if (bloom) bloom.strength = s.bloom;

  const studio = name === 'studio' || name === 'tech';
  studioFloor.visible = studio;
  techFloor.visible = name === 'tech';
  ground.visible = !studio;
  world.visible = !studio;
  lampMat.emissiveIntensity = name === 'dusk' ? 6 : 0;
  parked.visible = t > 312 && t < 352 && name === 'track';

  // key light
  const c = new THREE.Vector3(...car.ground);
  if (name === 'track') {
    sun.color.set(0xfff1dc);
    sun.intensity = 3.2;
    sun.position.set(c.x + 55, c.y + 70, c.z + 40);
  } else if (name === 'dusk') {
    sun.color.set(0xff9a55);
    sun.intensity = 1.6;
    sun.position.set(c.x + 90, c.y + 22, c.z + 35);
  } else if (name === 'tech') {
    sun.color.set(0x9fd8ff);
    sun.intensity = 1.1;
    sun.position.set(c.x + 12, c.y + 22, c.z - 12);
  } else {
    sun.color.set(0xf4f7ff);
    sun.intensity = 1.3;
    sun.position.set(c.x + 10, c.y + 26, c.z - 14);
  }
  sun.target.position.copy(c);
  sun.target.updateMatrixWorld();

  // rim lights orbit in studio/tech (the “light sweep”)
  const on = studio ? 1 : 0;
  const ramp = name === 'studio' && t < 27 ? sm(0, 6, t) : 1;
  const a = t * 0.35;
  rim1.position.set(c.x + Math.cos(a) * 11, 6, c.z + Math.sin(a) * 11);
  rim2.position.set(c.x + Math.cos(a + Math.PI) * 11, 4, c.z + Math.sin(a + Math.PI) * 11);
  rim1.target.position.set(c.x, 0.7, c.z);
  rim2.target.position.set(c.x, 0.7, c.z);
  rim1.intensity = on * ramp * (name === 'tech' ? 140 : 170);
  rim2.intensity = on * ramp * 100;
  rim1.color.set(name === 'tech' ? 0x4fd0ff : 0x8fb8ff);
  rim1.target.updateMatrixWorld();
  rim2.target.updateMatrixWorld();

  // headlights / tail lights at dusk
  const lightsOn = name === 'dusk' && t > 440 ? sm(441, 444, t) : 0;
  headMats.forEach((m) => ((m.emissive = m.emissive || new THREE.Color()), m.emissive.set(0xfff1d8), (m.emissiveIntensity = lightsOn * 5)));
  tailMats.forEach((m) => (m.emissive.set(0xff1a1a), (m.emissiveIntensity = lightsOn * 2.4 + (name === 'track' && car.v < 40 && car.v > 1 && car.tt > 232 && car.tt < 250 ? 2.5 : 0))));
  headSpots.forEach((s) => (s.intensity = lightsOn * 2400));
}

// ------------------------------------------------------------------ per-frame
const _v = new THREE.Vector3(),
  _q = new THREE.Quaternion(),
  _w = new THREE.Vector3(),
  _vel = new THREE.Vector3();
const calloutDefs = [
  { text: 'DOWNWARD THRUSTER POD · CONCEPT', local: [0.68, 0.3, -1.1], a: 366, b: 392 },
  { text: 'REAR THRUST NOZZLE · CONCEPT', local: [-2.3, 0.62, 0.5], a: 380, b: 408 },
  { text: 'ADDED MASS & HEAT: UNKNOWN', local: [0.0, 0.5, -1.0], a: 396, b: 418 },
];

function frame(f) {
  const t = Math.min(f / FPS, DURATION - 1e-6);
  const car = carState(t);
  const car2 = carState(t + 0.04);
  const velY = (car2.alt - car.alt) / 0.04;
  const stage = stageAt(t);

  // car pose
  carRoot.position.set(...car.pos);
  carRoot.rotation.set(car.roll, car.yaw, car.pitch, 'YZX');
  carInner.position.y = car.drop;
  carRoot.updateMatrixWorld(true);
  for (const w of wheels) {
    w.tmp.setFromAxisAngle(w.axis, -car.spin);
    w.node.quaternion.copy(w.tmp).multiply(w.base);
  }

  // pods
  const d = car.deploy;
  pods.visible = d > 0.01;
  for (const p of podList) {
    const sgn = Math.sign(p.z) || 1;
    if (p.x > -2) p.holder.position.set(p.x, p.y, sgn * lerp(0.74, 1.02, d));
    p.holder.scale.setScalar(lerp(0.35, 1, d));
  }
  const glow = Math.max(car.down, car.rear);
  podGlow.emissiveIntensity = glow * 3 * d;

  applyStage(stage, t, car);
  studioFloor.position.set(car.ground[0], 0.03, car.ground[2]);
  techFloor.position.set(car.ground[0], 0, car.ground[2]);
  techFloor.rotation.y = car.yaw;

  // ground follows the camera (snapped to texture tiles → no texture swimming)
  // (camera pose is computed below; use the previous camera position stored in userData)

  // camera
  const sh = shotAt(t);
  const S = sh.shot;
  let org, yaw;
  if (S.mode === 'road') {
    const rs = carState(S.sRefT);
    org = [rs.ground[0], 0, rs.ground[2]];
    yaw = rs.yaw;
  } else {
    org = [car.pos[0], S.k * car.alt, car.pos[2]];
    yaw = car.yaw;
  }
  const fw = fwdOf(yaw),
    rt = rightOf(yaw);
  const toWorld = (p) => new THREE.Vector3(org[0] + fw[0] * p[0] + rt[0] * p[2], org[1] + p[1], org[2] + fw[2] * p[0] + rt[2] * p[2]);
  const camPos = toWorld(sh.p).add(new THREE.Vector3(...sh.shake));
  let look;
  if (S.track) look = new THREE.Vector3(car.pos[0] + sh.l[0], car.pos[1] + 0.6 + sh.l[1], car.pos[2] + sh.l[2]);
  else look = toWorld(sh.l);
  camera.position.copy(camPos);
  camera.up.set(0, 1, 0);
  camera.lookAt(look);
  camera.fov = sh.fov;
  const dist = camPos.distanceTo(new THREE.Vector3(...car.pos));
  camera.near = clamp(dist * 0.02, 0.05, 1.5);
  camera.far = 9000;
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);

  // ground re-centre
  ground.position.x = Math.round(camPos.x / GRID) * GRID;
  ground.position.z = Math.round(camPos.z / GRID) * GRID;

  // particles
  const scale = (H * DPR) / (2 * Math.tan(THREE.MathUtils.degToRad(sh.fov) / 2));
  _vel.set(car.vel[0], velY, car.vel[2]);
  const tt = car.tt;
  nozzleMarkers.forEach((n, i) => {
    const u = plumes[i].material.uniforms;
    n.marker.getWorldPosition(_w);
    _q.setFromRotationMatrix(carRoot.matrixWorld);
    const dirW = n.dir.clone().applyQuaternion(_q);
    u.uNozzle.value.copy(_w);
    u.uDir.value.copy(dirW);
    u.uVel.value.copy(_vel);
    u.uTime.value = tt;
    u.uScale.value = scale;
    u.uIntensity.value = (n.kind === 'down' ? car.down : car.rear) * d;
  });
  {
    const u = dust.material.uniforms;
    u.uTime.value = tt;
    u.uScale.value = scale;
    u.uCenter.value.set(car.ground[0], 0, car.ground[2]);
    u.uVel.value.set(_vel.x, 0, _vel.z);
    u.uIntensity.value = car.down * d * (1 - sm(5, 13, car.alt)) * (stage === 'track' ? 1 : 0);
  }
  thrusterLight.position.set(car.pos[0], car.pos[1] - 0.6, car.pos[2]);
  thrusterLight.intensity = glow * d * 70;

  // render
  if (composer) composer.render();
  else renderer.render(scene, camera);

  // HUD
  hud.update(t, car, fadeAlpha(t));
  const cl = calloutDefs.map((c) => {
    _v.set(...c.local);
    carRoot.localToWorld(_v);
    _v.project(camera);
    const o = _v.z < 1 && t >= 360 && t < 420 ? sm(c.a, c.a + 0.6, t) * (1 - sm(c.b - 0.6, c.b, t)) : 0;
    return { x: (_v.x * 0.5 + 0.5) * W + 40, y: (-_v.y * 0.5 + 0.5) * H - 12, text: c.text, o };
  });
  hud.setCallouts(cl);
}

window.__frame = frame;
window.__renderFrame = (f) => {
  frame(f);
  return true;
};
await document.fonts.load('700 20px Rajdhani');
await document.fonts.load('900 20px Orbitron');
await document.fonts.ready;
frame(0); // warm-up: compiles shaders
window.__ready = true;
console.log('READY');
