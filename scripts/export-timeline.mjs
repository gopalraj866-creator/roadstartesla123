import fs from 'node:fs';
import { carState, FPS, DURATION } from '../src/timeline.js';
const rows = [];
for (let f = 0; f < FPS * DURATION; f++) { const c = carState(f / FPS); rows.push([+c.v.toFixed(3), +c.alt.toFixed(2), +c.down.toFixed(3), +c.rear.toFixed(3), +c.deploy.toFixed(3)]); }
fs.mkdirSync('out', { recursive: true });
fs.writeFileSync('out/timeline.json', JSON.stringify({ fps: FPS, rows }));
