# Tesla Roadster "0–60 in under 1 second?" – 8-minute cinematic (Technical Talk India)

Three.js/WebGL film, 480 s @ 30 fps (14,400 frames), rendered on GitHub Actions to **1080p and 4K** MP4 with synthesized audio.

## Run it
1. Create a **public** GitHub repo (public = free Actions minutes; the full render is thousands of CPU-minutes) and push this folder.
2. Actions → "Render Roadster film" → Run workflow → quality `both` (or `1080p`, `4k`, `preview` = first 10 s test).
3. Download artifact **roadster-final** → `roadster_1080p.mp4`, `roadster_2160p.mp4`.
Rendering uses software WebGL (no GPU) split into parallel jobs; expect roughly 1–3 h for 1080p and several hours for 4K (max 20 parallel jobs).

## Textures / realism
`scripts/fetch-assets.mjs` downloads CC0 Poly Haven asphalt, ground, concrete, rock textures and sky HDRIs at build time (check the job log for which succeeded). If a download fails the renderer falls back to procedural textures / procedural sky.

## IMPORTANT: car model
`assets/models/ferrari.glb` (three.js example model) is only a **stand-in sports car – not a Tesla Roadster**. For the real look, add a licensed Roadster GLB as `assets/models/roadster.glb` (separate nodes named wheel_fl/fr/rl/rr help; body material name containing "body" gets the gunmetal paint). Check/credit the stand-in model's license before publishing.

## Honesty labels
The 0–60 timer, thrusters, flight and roll are labelled as illustrative / concept on screen; the Reality Check chapter (6:00–7:00) says the claims are unverified.

## Local test
`npm ci && CHROME_PATH=/usr/bin/google-chrome node scripts/render.mjs --res 1080 --frames 300,4000 --png out/stills`

Timeline lives in `src/timeline.js`; narration ideas in `NARRATION.md` (no voice-over is generated).
