import { sm, clamp } from './timeline.js';

const $ = (id) => document.getElementById(id);
const vis = (t, a, b, f = 0.5) => sm(a, a + f, t) * (1 - sm(b - f, b, t));
const set = (el, o) => {
  const v = o < 0.003 ? 0 : o;
  if (el._o !== v) {
    el.style.opacity = v;
    el._o = v;
  }
};
const txt = (el, s) => {
  if (el._s !== s) {
    el.textContent = s;
    el._s = s;
  }
};

const CHAPTERS = [
  [30, '01 · THE REVEAL'],
  [120, '02 · LAUNCH'],
  [180, '03 · HIGH SPEED'],
  [240, '04 · TAKEOFF — CONCEPT'],
  [285, '05 · FLIGHT — CONCEPT'],
  [330, '06 · LANDING — CONCEPT'],
  [360, '07 · REALITY CHECK'],
  [420, '08 · THE VERDICT'],
];

// [from, to, kicker, headline, detail]
const LOWER = [
  [31, 38, 'CHAPTER 01', 'THE REVEAL', 'Front three-quarter · studio lighting'],
  [70, 77, 'DETAIL', 'WHEELS', 'Forged-style rims · performance rubber'],
  [78, 85, 'DETAIL', 'BRAKES', 'Large ventilated discs · fixed calipers'],
  [86, 93, 'DETAIL', 'BODY PANELS', 'Metallic gunmetal paint · clear-coat'],
  [94, 101, 'DETAIL', 'GLASS ROOF', 'Open-air feel without a hard top'],
  [102, 110, 'DETAIL', 'REAR DIFFUSER', 'Managing airflow at speed'],
  [111, 119, 'DETAIL', 'TAILLIGHTS', 'Signature rear light bar'],
  [121, 128, 'CHAPTER 02', 'LAUNCH', 'Rolling start · closed test course'],
  [181, 188, 'CHAPTER 03', 'HIGH SPEED', 'Simulated top-speed run'],
  [241, 248, 'CHAPTER 04', 'TAKEOFF', 'Conceptual thruster pods deploy'],
  [286, 293, 'CHAPTER 05', 'FLIGHT', 'Concept simulation · not a real capability'],
  [304, 313, 'MANEUVER', 'SLOW-MOTION ROLL', 'Controlled rotation about the long axis'],
  [331, 338, 'CHAPTER 06', 'FLIGHT FINALE', 'Fictional closed course · parked cars below'],
  [341, 348, 'LANDING', 'TOUCHDOWN', 'Suspension compresses and rebounds'],
];

const CARDS = [
  [366, 'w', 'ADVERTISED CLAIM', '0–60 mph in under 1.0 s is a company claim. It has not been independently verified.'],
  [375, '', 'PHYSICS CHECK', 'Under 1 second means roughly 2.7 g of average acceleration. Tyre grip is normally the limit, not motor power.'],
  [384, 'w', 'WHAT YOU SAW', 'The launch in this film is an illustrative simulation tuned to the claimed number. It is not test data.'],
  [393, 'r', 'ROCKET-ASSISTED IDEA', 'Thruster hover, flight and barrel rolls shown here are a CONCEPT. No such capability has been demonstrated.'],
  [402, '', 'BOTTOM LINE', 'Wait for independent, instrumented testing before trusting any headline number.'],
];

export function createHud() {
  const e = {
    chapter: $('chapter'),
    badge: $('badge'),
    speed: $('speed'),
    mph: document.querySelector('#speed .mph'),
    kmh: document.querySelector('#speed .kmh'),
    bar: document.querySelector('#speed .bar i'),
    timer: $('timer'),
    big: document.querySelector('#timer .big'),
    tsub: document.querySelector('#timer .sub'),
    alt: $('alt'),
    altv: $('altv'),
    thv: $('thv'),
    lower: $('lower'),
    la: document.querySelector('#lower .a'),
    lb: document.querySelector('#lower .b'),
    lc: document.querySelector('#lower .c'),
    title: $('title'),
    tt: document.querySelector('#title .t'),
    ts: document.querySelector('#title .s'),
    count: $('count'),
    panel: $('panel'),
    callouts: $('callouts'),
    foot: $('foot'),
    fade: $('fade'),
    flash: $('flash'),
    brand: $('brand'),
  };
  // build cards once
  e.panel.innerHTML = CARDS.map((c) => `<div class="card ${c[1]}"><h4>${c[2]}</h4><p>${c[3]}</p></div>`).join('');
  const cardEls = [...e.panel.children];
  const calloutEls = [];

  return {
    setCallouts(list) {
      while (calloutEls.length < list.length) {
        const d = document.createElement('div');
        d.className = 'callout';
        e.callouts.appendChild(d);
        calloutEls.push(d);
      }
      calloutEls.forEach((d, i) => {
        const c = list[i];
        if (!c || c.o < 0.01) return (d.style.display = 'none');
        d.style.display = 'block';
        d.style.opacity = c.o;
        d.style.left = c.x + 'px';
        d.style.top = c.y + 'px';
        d.textContent = c.text;
      });
    },
    update(t, car, fade) {
      // chapter tag
      let ch = '';
      for (const [a, s] of CHAPTERS) if (t >= a) ch = s;
      txt(e.chapter, t >= 30 && t < 478 ? ch : '');
      set(e.chapter, t >= 30 ? 1 : 0);

      // badge
      let badge = '',
        bc = '';
      if (t >= 27 && t < 30) badge = 'ILLUSTRATIVE LAUNCH';
      else if (t >= 120 && t < 240) badge = t < 180 ? 'SIMULATION · CLAIMED FIGURES' : 'SIMULATION';
      else if (t >= 240 && t < 360) badge = 'CONCEPT SIMULATION';
      else if (t >= 360 && t < 420) badge = 'CONCEPT · UNVERIFIED';
      txt(e.badge, badge);
      set(e.badge, badge ? 0.75 + 0.25 * Math.sin(t * 3) : 0);

      // speed
      const sp = vis(t, 121, 358, 1) + vis(t, 421, 437, 0.5);
      set(e.speed, clamp(sp));
      txt(e.mph, String(Math.round(car.mph)));
      txt(e.kmh, Math.round(car.kmh) + ' KM/H');
      const w = clamp(car.mph / 250) * 100 + '%';
      if (e.bar._w !== w) (e.bar.style.width = w), (e.bar._w = w);

      // 0-60 timer (launch + teaser)
      const tt = car.tt;
      const tOn = (t >= 135 && t < 144) || (t >= 27.2 && t < 30);
      const el = clamp(tt - 135, 0, 0.95);
      txt(e.big, el.toFixed(2) + ' s');
      set(e.timer, tOn ? (t < 30 ? 1 : vis(t, 135, 144, 0.4)) : 0);

      // altitude / thrust
      set(e.alt, vis(t, 253, 351, 1));
      txt(e.altv, car.alt.toFixed(1) + ' m');
      txt(e.thv, Math.round(Math.max(car.down, car.rear) * 100) + '%');

      // lower third
      let L = null;
      for (const l of LOWER) if (t >= l[0] && t < l[1]) L = l;
      if (L) {
        txt(e.la, L[2]);
        txt(e.lb, L[3]);
        txt(e.lc, L[4]);
      }
      set(e.lower, L ? vis(t, L[0], L[1], 0.6) : 0);

      // titles
      let T = '',
        S = '',
        o = 0;
      if (t >= 5 && t < 11.5) (T = ''), (S = 'A CLAIM WORTH TESTING'), (o = vis(t, 5, 11.5, 1.2));
      else if (t >= 21 && t < 27) (T = '0–60 MPH IN UNDER 1 SECOND?'), (S = 'TECHNICAL TALK INDIA'), (o = vis(t, 21, 27, 0.5));
      else if (t >= 448 && t < 462) (T = 'THE FUTURE OF PERFORMANCE?'), (S = ''), (o = vis(t, 448, 462, 1.2));
      else if (t >= 466 && t < 480) (T = 'Would you drive a rocket-assisted electric car?'), (S = 'TECHNICAL TALK INDIA'), (o = vis(t, 466, 480, 1.4));
      txt(e.tt, T);
      txt(e.ts, S);
      e.tt.style.fontSize = T.length > 30 ? '66px' : '88px';
      set(e.title, o);

      // countdown
      let n = '';
      if (t >= 12 && t < 21) n = String(3 - Math.floor((t - 12) / 3));
      const ph = n ? ((t - 12) % 3) / 3 : 0;
      txt(e.count, n);
      set(e.count, n ? (1 - sm(0.55, 1, ph)) * sm(0, 0.08, ph) : 0);
      e.count.style.transform = `scale(${1 + 0.25 * ph})`;

      // reality-check cards
      cardEls.forEach((c, i) => {
        const a = CARDS[i][0];
        const o2 = sm(a, a + 0.6, t) * (1 - sm(417, 419, t));
        c.style.opacity = o2;
        c.style.transform = `translateX(${(1 - sm(a, a + 0.6, t)) * 40}px)`;
      });
      set(e.panel, t >= 360 && t < 420 ? 1 : 0);

      // footer disclaimer
      set(e.foot, t >= 121 && t < 440 ? 0.8 : 0);

      // brand
      set(e.brand, 1 - 0.0);

      // flash into the teaser
      const fl = 0.9 * (1 - clamp(Math.abs(t - 27.0) / 0.14));
      e.flash.style.opacity = fl;
      e.fade.style.opacity = fade;
    },
  };
}
