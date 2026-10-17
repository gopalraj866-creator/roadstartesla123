// Downloads CC0 assets from Poly Haven (textures + HDRIs) and writes assets/manifest.json.
// Anything that fails is skipped; the renderer then falls back to procedural textures / sky.
import fs from 'node:fs';
import path from 'node:path';
const UA = { 'User-Agent': 'roadster-cinematic/1.0 (technical talk india)' };
const OUT = 'assets';
fs.mkdirSync(`${OUT}/textures`, { recursive: true });
fs.mkdirSync(`${OUT}/hdri`, { recursive: true });
const CAND = {
  asphalt: ['asphalt_02', 'asphalt_04', 'asphalt_01', 'asphalt_03', 'asphalt_05'],
  ground: ['aerial_rocks_02', 'rocky_terrain_02', 'coast_sand_rocks_02', 'dry_ground_rocks', 'sandy_gravel_02', 'gravel_ground_01'],
  concrete: ['concrete_wall_008', 'concrete_floor_02', 'concrete_wall_006', 'concrete_slab_wall'],
  rock: ['rock_boulder_cracked', 'rock_face_03', 'rock_09', 'aerial_rocks_01'],
};
const HDRI = { day: ['kloppenheim_06_puresky', 'kloppenheim_02_puresky', 'qwantani_puresky', 'kloppenheim_03_puresky'], dusk: ['qwantani_dusk_2_puresky', 'kloppenheim_07_puresky', 'evening_road_01_puresky'] };
const getJson = async (u) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(r.status); return r.json(); };
const save = async (u, f) => { const r = await fetch(u, { headers: UA }); if (!r.ok) throw new Error(r.status + ' ' + u); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); };
const pick = (o, names) => { for (const k of Object.keys(o || {})) if (names.includes(k.toLowerCase())) return o[k]; };
const res = (o) => o && (o['2k'] || o['1k'] || o['4k']);
const manifest = { hdri: {} };
for (const [name, ids] of Object.entries(CAND)) {
  for (const id of ids) {
    try {
      const f = await getJson(`https://api.polyhaven.com/files/${id}`);
      const set = {};
      for (const [slot, keys] of [['diff', ['diffuse', 'diff', 'color']], ['nor', ['nor_gl', 'normal']], ['rough', ['rough', 'roughness']]]) {
        const u = res(pick(f, keys))?.jpg?.url;
        if (!u) continue;
        const p = `${OUT}/textures/${name}_${slot}.jpg`;
        await save(u, p);
        set[slot] = '/' + p;
      }
      if (!set.diff) throw new Error('no diffuse');
      manifest[name] = set;
      console.log('texture', name, '=', id);
      break;
    } catch (e) { console.log('skip', id, String(e.message || e)); }
  }
}
for (const [name, ids] of Object.entries(HDRI)) {
  for (const id of ids) {
    try {
      const f = await getJson(`https://api.polyhaven.com/files/${id}`);
      const u = res(f.hdri)?.hdr?.url;
      if (!u) throw new Error('no hdr');
      const p = `${OUT}/hdri/${name}.hdr`;
      await save(u, p);
      manifest.hdri[name] = '/' + p;
      console.log('hdri', name, '=', id);
      break;
    } catch (e) { console.log('skip', id, String(e.message || e)); }
  }
}
if (fs.existsSync(`${OUT}/models/roadster.glb`)) manifest.car = `/${OUT}/models/roadster.glb`;
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest));
