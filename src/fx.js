import * as THREE from 'three';

// Stateless GPU particle systems: every particle's position is a pure function of
// (time, per-particle random seed, emitter uniforms) so any frame renders identically
// on any render shard – no simulation state to carry between frames.

const PLUME_VS = /* glsl */ `
uniform float uTime, uIntensity, uLife, uSpeed, uSize, uSpread, uScale, uSeed;
uniform vec3 uNozzle, uDir, uVel;
attribute vec4 aRand;
varying float vAge;
varying float vI;
void main(){
  float age = fract(uTime / uLife + aRand.x + uSeed);
  float ta = age * uLife;
  vec3 d = normalize(uDir);
  vec3 side = normalize(cross(d, abs(d.y) > 0.9 ? vec3(1.,0.,0.) : vec3(0.,1.,0.)));
  vec3 up2 = cross(d, side);
  float sp = uSpread * (0.15 + age * 1.6);
  vec3 off = (side * (aRand.y - 0.5) + up2 * (aRand.z - 0.5)) * 2.0 * sp;
  vec3 pos = uNozzle + d * uSpeed * ta * (0.55 + 0.45 * aRand.w) + off - uVel * ta * 0.92;
  // jet hits the ground: flatten and splash outwards
  if (pos.y < 0.06) {
    float over = 0.06 - pos.y;
    pos.y = 0.06 + over * 0.15;
    vec3 flatDir = normalize(vec3(pos.x - uNozzle.x, 0.0, pos.z - uNozzle.z) + 1e-4);
    pos += flatDir * over * 1.6;
  }
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float fadeIn = smoothstep(0.0, 0.04, age);
  vI = uIntensity * pow(1.0 - age, 1.4) * fadeIn;
  vAge = age;
  gl_PointSize = uSize * (0.55 + age * 3.2) * (0.7 + aRand.w * 0.6) * uScale / max(0.1, -mv.z);
  if (uIntensity < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const PLUME_FS = /* glsl */ `
varying float vAge;
varying float vI;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  float a = pow(1.0 - r, 2.0) * vI;
  vec3 hot = vec3(0.85, 0.93, 1.0);
  vec3 mid = vec3(0.35, 0.65, 1.0);
  vec3 cool = vec3(1.0, 0.42, 0.12);
  vec3 col = mix(hot, mid, smoothstep(0.0, 0.25, vAge));
  col = mix(col, cool, smoothstep(0.25, 0.9, vAge));
  gl_FragColor = vec4(col * (1.6 - vAge), a);
}`;

const DUST_VS = /* glsl */ `
uniform float uTime, uIntensity, uScale, uRadius;
uniform vec3 uCenter, uVel;
attribute vec4 aRand;
varying float vA;
void main(){
  float life = 4.0;
  float age = fract(uTime / life + aRand.x);
  float ta = age * life;
  float ang = aRand.y * 6.2831853;
  float rad = 1.0 + (0.25 + age * 1.1) * uRadius * (0.5 + aRand.z * 0.7);
  vec3 pos = uCenter + vec3(cos(ang) * rad, 0.25 + age * 2.2 * aRand.w + aRand.w * 0.5, sin(ang) * rad) - uVel * ta * 0.35;
  vec4 mv = viewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  vA = uIntensity * (1.0 - age) * smoothstep(0.0, 0.08, age) * 0.28;
  gl_PointSize = (2.0 + age * 7.0) * (0.6 + aRand.z) * uScale / max(0.1, -mv.z);
  if (uIntensity < 0.002) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}`;
const DUST_FS = /* glsl */ `
varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(vec3(0.78, 0.7, 0.58), vA * (1.0 - r));
}`;

function rands(n, seed) {
  let s = seed >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const a = new Float32Array(n * 4);
  for (let i = 0; i < a.length; i++) a[i] = rnd();
  return a;
}

export function makePlume(count, seed, opts = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rands(count, seed), 4));
  const m = new THREE.ShaderMaterial({
    vertexShader: PLUME_VS,
    fragmentShader: PLUME_FS,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uLife: { value: opts.life ?? 0.9 },
      uSpeed: { value: opts.speed ?? 16 },
      uSize: { value: opts.size ?? 0.35 },
      uSpread: { value: opts.spread ?? 0.22 },
      uScale: { value: 1000 },
      uSeed: { value: (seed % 97) / 97 },
      uNozzle: { value: new THREE.Vector3() },
      uDir: { value: new THREE.Vector3(0, -1, 0) },
      uVel: { value: new THREE.Vector3() },
    },
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 10;
  return p;
}

export function makeDust(count, seed) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('aRand', new THREE.BufferAttribute(rands(count, seed), 4));
  const m = new THREE.ShaderMaterial({
    vertexShader: DUST_VS,
    fragmentShader: DUST_FS,
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uScale: { value: 1000 },
      uRadius: { value: 12 },
      uCenter: { value: new THREE.Vector3() },
      uVel: { value: new THREE.Vector3() },
    },
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.renderOrder = 9;
  return p;
}
