// Renders a frame range of the film to an H.264 segment.
//   node scripts/render.mjs --res 1080 --from 0 --to 600 --out out/seg_000.mp4
//   node scripts/render.mjs --res 1080 --frames 100,2000,5000 --png out/test   (stills)
import puppeteer from 'puppeteer-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './server.mjs';

const a = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, arr) => (v.startsWith('--') ? [...acc, [v.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true]] : acc), []));
const RES = Number(a.res || 1080);
const DSF = RES >= 2160 ? 2 : 1;
const CHROME = process.env.CHROME_PATH || a.chrome || '/usr/bin/google-chrome';
const query = a.query || '';
const { srv, port } = await startServer();

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  protocolTimeout: 0,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--hide-scrollbars', '--force-color-profile=srgb', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--allow-file-access-from-files'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: DSF });
await page.goto(`http://127.0.0.1:${port}/index.html${query}`, { waitUntil: 'load', timeout: 0 });
await page.waitForFunction('window.__ready === true', { timeout: 15 * 60 * 1000 });

const shot = async () => page.screenshot({ type: 'jpeg', quality: 96, optimizeForSpeed: true });

if (a.frames) {
  const dir = a.png || 'out/stills';
  fs.mkdirSync(dir, { recursive: true });
  for (const f of String(a.frames).split(',').map(Number)) {
    const t0 = Date.now();
    await page.evaluate((f) => window.__renderFrame(f), f);
    const buf = await page.screenshot({ type: 'png' });
    fs.writeFileSync(path.join(dir, `f${String(f).padStart(5, '0')}.png`), buf);
    console.log(`frame ${f} done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }
} else {
  const from = Number(a.from),
    to = Number(a.to);
  const out = a.out;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', a.preset || 'medium', '-crf', String(a.crf || 14), '-pix_fmt', 'yuv420p', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0', '-bf', '2', '-r', '30', '-movflags', '+faststart', '-an', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((r) => ff.on('close', r));
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    await page.evaluate((f) => window.__renderFrame(f), f);
    const buf = await shot();
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    if ((f - from) % 10 === 0) {
      const el = (Date.now() - t0) / 1000,
        n = f - from + 1;
      console.log(`frame ${f} (${n}/${to - from}) ${(el / n).toFixed(2)} s/frame, eta ${(((to - from - n) * el) / n / 60).toFixed(1)} min`);
    }
  }
  ff.stdin.end();
  await done;
  console.log('segment written', out);
}
await browser.close();
srv.close();
