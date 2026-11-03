// Sandbox: renders every biome's generated terrain (with a few craters and a collapse) over a plain sky.
import { BIOMES, BIOME_IDS } from '../src/core/biomes.ts';
import { WORLD_H, WORLD_W } from '../src/core/constants.ts';
import { generateTerrain, makeDirtPainter } from '../src/sim/terrainGen.ts';

const grid = document.getElementById('grid')!;
const seed = Number(new URLSearchParams(location.search).get('seed') ?? 4242);

for (const id of BIOME_IDS) {
  const biome = BIOMES[id];
  const t0 = performance.now();
  const { terrain, spawns } = generateTerrain(biome, seed);
  const genMs = performance.now() - t0;
  // Some battle damage: craters, a tunnel, a mound, then collapse.
  terrain.carveCircle(WORLD_W * 0.5, terrain.surfaceY(WORLD_W * 0.5) + 10, 70, 1);
  terrain.carveCircle(WORLD_W * 0.35, terrain.surfaceY(WORLD_W * 0.35) + 40, 45, 1);
  terrain.carveCapsule(WORLD_W * 0.6, terrain.surfaceY(WORLD_W * 0.6) + 60, WORLD_W * 0.7, terrain.surfaceY(WORLD_W * 0.7) + 90, 10);
  terrain.raiseMound(WORLD_W * 0.42, 92, 83, makeDirtPainter(biome, seed));
  terrain.settleAll();

  const canvas = document.createElement('canvas');
  canvas.width = WORLD_W;
  canvas.height = WORLD_H;
  const ctx = canvas.getContext('2d')!;
  const sky = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  sky.addColorStop(0, biome.palette.sky[0]);
  sky.addColorStop(0.55, biome.palette.sky[1]);
  sky.addColorStop(1, biome.palette.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);
  const img = ctx.createImageData(WORLD_W, WORLD_H);
  terrain.writeRGBA({ x0: 0, y0: 0, x1: WORLD_W, y1: WORLD_H }, img.data);
  const layer = document.createElement('canvas');
  layer.width = WORLD_W;
  layer.height = WORLD_H;
  layer.getContext('2d')!.putImageData(img, 0, 0);
  ctx.drawImage(layer, 0, 0);
  ctx.fillStyle = '#fff';
  for (const sx of spawns) ctx.fillRect(sx - 28, terrain.surfaceY(sx) - 20, 56, 20);
  ctx.font = '28px system-ui';
  ctx.fillText(`${biome.name} · gen ${genMs.toFixed(0)} ms`, 20, 40);
  const fig = document.createElement('figure');
  fig.appendChild(canvas);
  grid.appendChild(fig);
}
