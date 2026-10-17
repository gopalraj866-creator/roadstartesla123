// Deterministic simulation clock for the whole film (0 → 480 s).
// Pure functions of time: car, wheels, camera, HUD and particles all read from here.
// No three.js import so it can be unit-tested in plain Node.

export const FPS = 30;
export const DURATION = 480;
export const DT = 1 / 120;
export const WHEEL_R = 0.34;
export const START_S = 120; // start line distance along the road (m)
export const LANE = 1.9; // car sits in the right-hand lane (m right of centre line)
export const ROAD_W = 15;

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const sm = (a, b, x) => {
  const k = clamp((x - a) / (b - a));
  return k * k * (3 - 2 * k);
};
export const lerp = (a, b, k) => a + (b - a) * k;

// ---------------------------------------------------------------- time remap
// Some scenes reuse another moment of the simulation (teaser, final pass …)
export function simT(t) {
  if (t >= 27 && t < 30) return 135 + (t - 27); // hook teaser = first 3 s of the launch
  if (t >= 360 && t < 420) return 400; // tech section: car parked after landing
  if (t >= 420 && t < 438) return 212 + (t - 420); // final high-speed pass
  if (t >= 438) return 251; // final scene: parked at the braking zone
  return t;
}

// ---------------------------------------------------------------- speed (m/s)
const V60 = 26.8224; // 60 mph
const T60 = 0.95; // ILLUSTRATIVE: the claimed "under 1 s" figure, not a verified one
const launchV = (tau) =>
  tau < T60 ? (V60 * tau) / T60 : V60 + (100 - V60) * (1 - Math.exp(-(tau - T60) / 12));
const V180 = launchV(45);
const cruise = (t) => V180 + 6 * sm(180, 205, t);

function baseSpeed(t) {
  if (t < 135) return 0;
  if (t < 180) return launchV(t - 135);
  if (t < 232) return cruise(t);
  if (t < 250) return cruise(232) * (1 - sm(0, 1, (t - 232) / 18));
  if (t < 278) return 0;
  if (t < 330) return 65 * sm(278, 300, t);
  if (t < 348) return 65 - 37 * sm(330, 348, t);
  if (t < 361) return 28 * (1 - sm(348, 361, t));
  return 0;
}
// slow-motion window around the barrel roll
const slowMo = (t) => 1 - 0.65 * sm(300, 305, t) * (1 - sm(318, 324, t));
export const speedAt = (t) => baseSpeed(t) * slowMo(t);

// ---------------------------------------------------------------- distance table
const N = Math.round(DURATION / DT) + 2;
const S = new Float64Array(N);
{
  let s = START_S;
  for (let i = 0; i < N; i++) {
    S[i] = s;
    s += 0.5 * (speedAt(i * DT) + speedAt((i + 1) * DT)) * DT;
  }
}
export function distAt(t) {
  const x = clamp(t, 0, DURATION) / DT;
  const i = Math.floor(x);
  return lerp(S[i], S[i + 1], x - i);
}
export const END_S = S[N - 1];

// ---------------------------------------------------------------- road path
// Straight everywhere except a sweeping left-hander the car takes at 198–212 s.
const BEND_S0 = distAt(197);
const BEND_S1 = distAt(213);
const BEND_ANGLE = 1.25; // rad (~72°)
const STEP = 2;
const PATH_LEN = END_S + 2500;
const PN = Math.ceil(PATH_LEN / STEP) + 1;
export const path = { step: STEP, n: PN, x: new Float32Array(PN), z: new Float32Array(PN), th: new Float32Array(PN) };
{
  let x = 0,
    z = 0;
  for (let i = 0; i < PN; i++) {
    const s = i * STEP;
    const th = BEND_ANGLE * sm(BEND_S0, BEND_S1, s);
    path.x[i] = x;
    path.z[i] = z;
    path.th[i] = th;
    x += Math.cos(th) * STEP;
    z -= Math.sin(th) * STEP;
  }
}
export function pathAt(s) {
  const f = clamp(s / STEP, 0, PN - 1.001);
  const i = Math.floor(f),
    k = f - i;
  const th = lerp(path.th[i], path.th[i + 1], k);
  return { x: lerp(path.x[i], path.x[i + 1], k), z: lerp(path.z[i], path.z[i + 1], k), th };
}
// right-hand vector for heading th (three.js: rotation.y = th ⇒ local +Z maps to (sin th, 0, cos th))
export const rightOf = (th) => [Math.sin(th), 0, Math.cos(th)];
export const fwdOf = (th) => [Math.cos(th), 0, -Math.sin(th)];

// ---------------------------------------------------------------- flight envelope
export function altitude(t) {
  const lift = 11 * sm(256, 285, t) + 3 * sm(292, 308, t);
  const land = 1 - sm(328, 348, t);
  return lift * land;
}
export const rollAt = (t) => 2 * Math.PI * sm(304, 320, t);
export function thrusts(t) {
  // hover thrusters (pointing down) and rear thrusters (pointing back)
  const down = sm(252, 259, t) * (1 - 0.65 * sm(328, 346, t)) * (1 - sm(346, 350, t));
  const rear = sm(276, 284, t) * (1 - sm(326, 338, t)) * 0.95;
  return { down, rear };
}
export const deployAt = (t, tt) => (t >= 360 && t < 420 ? 1 : t >= 420 ? 0 : sm(246, 254, tt) * (1 - sm(350, 357, tt)));

// ---------------------------------------------------------------- full car state
export function carState(t) {
  const tt = simT(t);
  const s = distAt(tt);
  const p = pathAt(s);
  const r = rightOf(p.th);
  const v = speedAt(tt);
  const acc = (speedAt(tt + 0.05) - speedAt(tt - 0.05)) / 0.1;
  const alt0 = altitude(tt);
  const hover = sm(258, 270, tt) * (1 - sm(328, 340, tt)); // gentle sway while hovering
  const sway = hover * (0.07 * Math.sin(tt * 1.7) + 0.05 * Math.sin(tt * 0.9 + 1));
  const alt = alt0 + (alt0 > 0.5 ? sway * 2 : 0);
  const grounded = 1 - sm(0.2, 1.5, alt0);

  let pitch =
    0.04 * sm(262, 276, tt) * (1 - sm(278, 290, tt)) -
    0.06 * sm(285, 300, tt) * (1 - sm(328, 340, tt)) +
    0.05 * sm(336, 344, tt) * (1 - sm(346, 351, tt));
  pitch += grounded * clamp(acc * 0.0011, -0.04, 0.04);
  pitch += sway * 0.25;
  const roll = rollAt(tt) + sway * 0.4;

  let drop = 0.07 * sm(249, 255, tt) - 0.07 * sm(255, 258, tt); // pre-launch squat
  if (tt >= 348) {
    const tau = tt - 348;
    drop += -0.1 * Math.exp(-3.5 * tau) * Math.sin(8 * tau); // touchdown compress + rebound
  }
  const th = thrusts(tt);
  let down = th.down,
    rear = th.rear;
  if (t >= 360 && t < 420) {
    // test-fire sequence for the tech section
    const k = (t - 360) % 12;
    down = 0.5 * Math.pow(sm(0, 0.4, k) * (1 - sm(1.2, 2.6, k)), 1) * (k < 6 ? 1 : 0.0);
    rear = 0.5 * sm(6, 6.4, k) * (1 - sm(7.2, 8.6, k));
  }
  return {
    t,
    tt,
    s,
    pos: [p.x + r[0] * LANE, alt, p.z + r[2] * LANE],
    ground: [p.x + r[0] * LANE, 0, p.z + r[2] * LANE],
    yaw: p.th,
    pitch,
    roll,
    alt,
    alt0,
    drop,
    v,
    mph: v * 2.23694,
    kmh: v * 3.6,
    spin: (distAt(tt) - START_S) / WHEEL_R,
    down,
    rear,
    deploy: deployAt(t, tt),
    vel: [fwdOf(p.th)[0] * v, 0, fwdOf(p.th)[2] * v],
  };
}

// ---------------------------------------------------------------- camera shots
// Coordinates are in a frame [forward, up, right]. mode:
//   car  → frame follows the car (yaw only; vertical follow factor k)
//   road → frame is fixed in the world at the road position of sim-time sRefT
const deg = Math.PI / 180;
function orbit(t0, t1, a0, a1, r0, r1, h0, h1, o = {}) {
  const keys = [];
  const n = Math.max(2, Math.round((t1 - t0) / 2) + 1);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    const a = lerp(a0, a1, k) * deg,
      r = lerp(r0, r1, k);
    keys.push({
      t: lerp(t0, t1, k),
      p: [Math.cos(a) * r, lerp(h0, h1, k), Math.sin(a) * r],
      l: o.l || [0, 0.65, 0],
      fov: o.fov || 34,
    });
  }
  return { t0, t1, mode: 'car', k: 0, shake: o.shake || 0.004, keys };
}
const K = (t, p, l, fov) => ({ t, p, l, fov });
const shot = (t0, t1, keys, o = {}) => ({ t0, t1, mode: 'car', k: 0, shake: 0.006, keys, ...o });

export const SHOTS = [
  // 01 hook
  shot(0, 27, [K(0, [-15, 1.5, 5.5], [0, 0.7, 0], 32), K(27, [-6.4, 1.05, 3.6], [0.2, 0.65, 0], 32)], { shake: 0.003 }),
  shot(27, 30, [K(27, [-6.5, 1.2, 2.8], [3, 0.8, 0], 55), K(30, [-11, 1.7, 3.4], [6, 0.9, 0], 80)], { shake: 0.05 }),
  // 02 reveal
  orbit(30, 70, 32, 392, 8.8, 7.4, 1.25, 1.6),
  shot(70, 78, [K(70, [2.6, 0.55, -2.6], [1.35, 0.38, -0.85], 30), K(78, [2.1, 0.45, -2.0], [1.35, 0.38, -0.85], 28)]),
  shot(78, 86, [K(78, [-0.4, 0.34, -1.9], [-1.35, 0.34, -0.85], 26), K(86, [-0.9, 0.42, -1.5], [-1.35, 0.34, -0.85], 22)]),
  shot(86, 94, [K(86, [-0.4, 0.95, -2.5], [-0.4, 0.75, -0.9], 30), K(94, [1.3, 0.95, -2.5], [1.2, 0.75, -0.9], 30)]),
  shot(94, 102, [K(94, [-1.4, 2.8, 1.8], [-0.2, 1.1, 0], 38), K(102, [1.0, 2.9, -1.2], [-0.2, 1.1, 0], 38)]),
  shot(102, 111, [K(102, [-3.6, 0.4, 1.4], [-2.2, 0.35, 0], 36), K(111, [-3.0, 0.3, -1.0], [-2.2, 0.35, 0], 36)]),
  shot(111, 120, [K(111, [-3.5, 1.0, -1.8], [-2.2, 0.85, 0], 30), K(120, [-3.2, 1.0, 1.8], [-2.2, 0.85, 0], 30)]),
  // 03 launch
  shot(120, 135, [K(120, [-7.5, 1.1, 3.0], [2, 0.65, 0], 40), K(135, [-8.5, 1.2, 2.2], [2, 0.65, 0], 40)]),
  shot(135, 150, [K(135, [-6.2, 1.25, 0.8], [4, 0.75, 0], 52), K(150, [-9.5, 1.9, 1.6], [4, 0.75, 0], 70)], { shake: 0.03 }),
  shot(150, 165, [K(150, [3.2, 0.45, -2.8], [0, 0.4, -0.8], 45), K(165, [0.5, 0.4, -3.2], [0, 0.4, -0.8], 45)], { shake: 0.05 }),
  shot(165, 180, [K(165, [-9, 3.5, 0], [2, 0.5, 0], 60), K(180, [-12, 4.2, 2], [2, 0.5, 0], 70)], { shake: 0.04 }),
  // 04 high speed
  shot(180, 195, [K(180, [0.8, 0.45, -5.5], [0.2, 0.55, 0], 38), K(195, [-0.5, 0.5, -4.8], [0.2, 0.55, 0], 38)], { shake: 0.05 }),
  shot(195, 212, [K(195, [-2, 26, -3], [8, 0, 0], 50), K(212, [-4, 34, -6], [8, 0, 0], 50)], { shake: 0.02 }),
  shot(212, 222, [K(212, [1.2, 0.32, -2.4], [1.35, 0.34, -0.85], 26), K(222, [0.9, 0.3, -2.0], [1.35, 0.34, -0.85], 26)], { shake: 0.02 }),
  shot(222, 232, [K(222, [8, 0.9, 1.2], [0, 0.65, 0], 40), K(232, [6, 0.8, 0.8], [0, 0.65, 0], 40)], { shake: 0.04 }),
  shot(232, 240, [K(232, [-1, 0.9, -5.5], [0.8, 0.6, 0], 36), K(240, [-1, 0.9, -5.5], [0.8, 0.6, 0], 36)], { shake: 0.03 }),
  // 05 takeoff
  shot(240, 250, [K(240, [-6, 0.9, -5], [0.3, 0.5, 0], 34), K(250, [-5.2, 0.9, -5], [0.3, 0.5, 0], 34)]),
  shot(250, 262, [K(250, [-9, 0.9, 6.5], [0, 0.8, 0], 36), K(262, [-8, 1.1, 5.5], [0, 0.8, 0], 36)], { k: 0.5, shake: 0.01 }),
  shot(262, 274, [K(262, [-6.5, 1.2, 4], [0, 0.8, 0], 42), K(274, [-5.5, 2.2, 6], [0, 0.8, 0], 42)], { k: 0.9, shake: 0.012 }),
  shot(274, 285, [K(274, [-14, 6, 9], [0, 1, 0], 40), K(285, [-13, 8, 10], [0, 1, 0], 40)], { k: 0.95, shake: 0.012 }),
  // 06 flight
  shot(285, 304, [K(285, [-13, 4, 2.5], [5, 0.5, 0], 55), K(304, [-11, 3.5, 4.5], [5, 0.5, 0], 55)], { k: 1, shake: 0.04 }),
  shot(
    304,
    320,
    [K(304, [2, 2.0, -12], [0, 0, 0], 38), K(312, [4.5, 0.2, -9.5], [0, 0, 0], 36), K(320, [6, -2.5, -6], [0, 0, 0], 34)],
    { k: 1, shake: 0.01 },
  ),
  shot(320, 330, [K(320, [-10, 6, 8], [4, 0.2, 0], 50), K(330, [-8, 3.5, 9], [4, 0.2, 0], 50)], { k: 1, shake: 0.03 }),
  // 07 finale
  shot(330, 340, [K(330, [-70, 5, -30], [0, -8, 0], 40), K(340, [-70, 5, -30], [0, -8, 0], 34)], { mode: 'road', sRefT: 333, track: true, shake: 0.006 }),
  shot(340, 350, [K(340, [-6, 0.8, -7.5], [0, 0.5, 0], 36), K(350, [1, 0.6, -6.5], [0, 0.5, 0], 36)], { shake: 0.01 }),
  shot(350, 360, [K(350, [-7, 1.1, 3.5], [1, 0.6, 0], 40), K(360, [-8, 1.5, 4.5], [1, 0.6, 0], 40)], { shake: 0.008 }),
  // 08 tech
  orbit(360, 372, 20, 110, 7, 6, 1.4, 2.0, { fov: 36 }),
  shot(372, 384, [K(372, [1.8, 0.6, 2.8], [0.65, 0.3, 0.98], 30), K(384, [0.9, 0.5, 2.3], [0.65, 0.3, 0.98], 30)]),
  shot(384, 396, [K(384, [-4.5, 0.9, 1.6], [-2.2, 0.55, 0.2], 32), K(396, [-3.6, 0.8, 0.9], [-2.2, 0.55, 0.2], 32)]),
  shot(396, 408, [K(396, [0, 7, 3.5], [0, 0.3, 0], 40), K(408, [0, 8.5, 0.1], [0, 0.3, 0], 40)]),
  shot(408, 420, [K(408, [-9, 2.2, 6], [0, 0.7, 0], 34), K(420, [-12, 3.2, 7], [0, 0.7, 0], 34)]),
  // 09 verdict
  shot(420, 428, [K(420, [0, 1.5, 25], [0, 0, 0], 28), K(428, [0, 1.5, 25], [0, 0, 0], 28)], { mode: 'road', sRefT: 218, track: true, shake: 0.01 }),
  shot(428, 438, [K(428, [14, 2.0, -4], [0, 0.6, 0], 40), K(438, [9, 1.5, -3.5], [0, 0.6, 0], 40)], { shake: 0.05 }),
  orbit(438, 462, 20, 200, 7.5, 6.2, 1.2, 1.0, { fov: 32 }),
  shot(462, 480, [K(462, [-7, 1.3, 4], [0, 0.7, 0], 30), K(480, [-24, 5, 12], [0, 0.7, 0], 28)], { shake: 0.004 }),
];

// Hermite interpolation with finite-difference tangents (handles uneven key spacing)
function hermite(keys, t, field) {
  const n = keys.length;
  if (t <= keys[0].t) return keys[0][field];
  if (t >= keys[n - 1].t) return keys[n - 1][field];
  let i = 0;
  while (i < n - 2 && t > keys[i + 1].t) i++;
  const a = keys[i],
    b = keys[i + 1];
  const h = b.t - a.t,
    u = (t - a.t) / h;
  const prev = keys[Math.max(0, i - 1)],
    next = keys[Math.min(n - 1, i + 2)];
  const sample = (A, B, P, Nx) => {
    const isArr = Array.isArray(A);
    const out = isArr ? [] : 0;
    const comps = isArr ? A.length : 1;
    for (let c = 0; c < comps; c++) {
      const p0 = isArr ? A[c] : A,
        p1 = isArr ? B[c] : B;
      const m0 = ((p1 - (isArr ? P[c] : P)) / Math.max(1e-6, b.t - prev.t)) * h;
      const m1 = (((isArr ? Nx[c] : Nx) - p0) / Math.max(1e-6, next.t - a.t)) * h;
      const u2 = u * u,
        u3 = u2 * u;
      const v = (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
      if (isArr) out.push(v);
      else return v;
    }
    return out;
  };
  return sample(a[field], b[field], prev[field], next[field]);
}

export function shotAt(t) {
  const tt = Math.min(t, DURATION - 1e-6);
  const sh = SHOTS.find((s) => tt >= s.t0 && tt < s.t1) || SHOTS[SHOTS.length - 1];
  const p = hermite(sh.keys, tt, 'p');
  const l = hermite(sh.keys, tt, 'l');
  const fov = hermite(sh.keys, tt, 'fov');
  // deterministic hand-held shake
  const a = sh.shake || 0;
  const sp = 1 + 0.02 * speedAt(simT(t));
  const w = (f, ph) => Math.sin(t * f + ph);
  const shake = [
    a * sp * (w(7.3, 0) + 0.5 * w(13.1, 1.3)),
    a * sp * (w(9.1, 2) + 0.5 * w(17.3, 0.4)),
    a * sp * (w(8.2, 4) + 0.5 * w(15.7, 2.2)),
  ];
  return { shot: sh, p, l, fov, shake };
}

// ---------------------------------------------------------------- cuts / fades
// Black dips are centred on stage changes (studio ↔ track ↔ tech ↔ dusk)
export const CUTS = [
  { c: 30, w: 0.4 },
  { c: 92, w: 0.7 },
  { c: 360, w: 0.8 },
  { c: 420, w: 0.8 },
  { c: 438, w: 1.0 },
];
export function fadeAlpha(t) {
  let a = 0;
  for (const { c, w } of CUTS) a = Math.max(a, 1 - clamp(Math.abs(t - c) / w));
  a = Math.max(a, 1 - sm(0, 2.5, t)); // fade in from black
  a = Math.max(a, sm(DURATION - 3, DURATION, t)); // fade out
  return a;
}

// stage = which environment is active
export function stageAt(t) {
  if (t < 27) return 'studio';
  if (t < 30) return 'track';
  if (t < 92) return 'studio';
  if (t < 360) return 'track';
  if (t < 420) return 'tech';
  if (t < 438) return 'track';
  return 'dusk';
}
