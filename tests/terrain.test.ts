import test from 'node:test';
import assert from 'node:assert/strict';
import { Terrain } from '../src/sim/terrain.ts';
import { generateTerrain, makeDirtPainter } from '../src/sim/terrainGen.ts';
import { BIOMES, BIOME_IDS } from '../src/core/biomes.ts';
import { BEDROCK_ROWS, SOLID_ALPHA, WORLD_H, WORLD_W } from '../src/core/constants.ts';
import { packRGBA } from '../src/core/color.ts';

const SOLID = packRGBA(120, 90, 60);

function flat(w = 200, h = 200, ground = 120): Terrain {
  const t = new Terrain(w, h);
  for (let x = 0; x < w; x++) for (let y = ground; y < h; y++) t.setPixel(x, y, SOLID);
  return t;
}

function solidCount(t: Terrain): number {
  let n = 0;
  for (let i = 0; i < t.px.length; i++) if (t.px[i] >>> 24 >= SOLID_ALPHA) n++;
  return n;
}

/** Every column's solid pixels form one contiguous run that reaches the bottom. */
function isCompacted(t: Terrain): boolean {
  for (let x = 0; x < t.w; x++) {
    let y = t.surfaceY(x);
    for (; y < t.h; y++) if (!t.isSolid(x, y)) return false;
  }
  return true;
}

test('queries: solidity, surface, out-of-bounds conventions', () => {
  const t = flat();
  assert.equal(t.isSolid(10, 119), false);
  assert.equal(t.isSolid(10, 120), true);
  assert.equal(t.isSolid(-1, 150), false, 'left of the world is air');
  assert.equal(t.isSolid(10, -5), false, 'sky is air');
  assert.equal(t.isSolid(10, 10_000), true, 'below the world is solid');
  assert.equal(t.surfaceY(50), 120);
  assert.equal(t.surfaceY(50, 150), 150);
  assert.equal(t.surfaceY(-3), t.h);
  const n = t.normalAt(100, 120);
  assert.ok(Math.abs(n.x) < 0.05 && n.y < -0.95, `flat normal points up, got ${n.x},${n.y}`);
  const hit = t.raycast(100, 50, 100, 180);
  assert.ok(hit && Math.abs(hit.y - 120) <= 1);
  assert.equal(t.raycast(10, 10, 190, 60), null);
});

test('carveCircle removes ground inside the radius only and never touches bedrock', () => {
  const t = flat(200, 200, 120);
  const before = solidCount(t);
  const removed = t.carveCircle(100, 130, 30);
  assert.ok(removed > 2000, `removed ${removed}`);
  assert.equal(solidCount(t), before - removed);
  assert.equal(t.isSolid(100, 130), false);
  assert.equal(t.isSolid(100, 161), true, "just outside the radius stays");
  assert.equal(t.isSolid(100, 158), false, "just inside the radius is removed");
  assert.equal(t.isSolid(40, 125), true);
  const deep = new Terrain(100, 100);
  for (let x = 0; x < 100; x++) for (let y = 40; y < 100; y++) deep.setPixel(x, y, SOLID);
  deep.carveCircle(50, 95, 40);
  for (let y = deep.bedrockTop; y < 100; y++) assert.equal(deep.isSolid(50, y), true, `bedrock row ${y}`);
  assert.equal(BEDROCK_ROWS > 0, true);
});

test('scorch darkens the crater rim without removing it', () => {
  const t = flat(200, 200, 120);
  const rimBefore = t.colorAt(100, 160) & 255;
  t.carveCircle(100, 125, 30, 1);
  const rimAfter = t.colorAt(100, 160) & 255;
  assert.ok(t.isSolid(100, 160));
  assert.ok(rimAfter < rimBefore, `rim red ${rimBefore} -> ${rimAfter}`);
});

test('unsupported ground collapses into a compact pile and conserves mass', () => {
  const t = flat(200, 200, 150);
  // A floating slab hovering above the ground.
  for (let x = 60; x < 140; x++) for (let y = 60; y < 90; y++) t.setPixel(x, y, SOLID);
  t.destabilize(60, 140);
  const mass = solidCount(t);
  assert.ok(t.settling);
  let frames = 0;
  while (t.settling && frames < 2000) { t.settle(1 / 60); frames++; }
  assert.equal(t.settling, false, 'settles eventually');
  assert.equal(solidCount(t), mass, 'no ground created or destroyed');
  assert.ok(isCompacted(t));
  assert.equal(t.surfaceY(100), 120, 'slab of 30 rows rests on ground at 150');
  assert.ok(frames > 5, 'collapse is animated over several frames');
});

test('carving a tunnel collapses the roof', () => {
  const t = flat(200, 200, 80);
  t.carveCapsule(40, 140, 160, 140, 10);
  t.settleAll();
  assert.ok(isCompacted(t));
  assert.ok(t.surfaceY(100) > 80, 'surface dropped after the roof fell in');
});

test('fillCircle adds ground into air, respects protected rectangles', () => {
  const t = flat(200, 200, 150);
  const before = solidCount(t);
  const added = t.fillCircle(100, 120, 25, () => SOLID, [{ x0: 95, y0: 110, x1: 105, y1: 130 }]);
  assert.ok(added > 1000);
  assert.equal(t.isSolid(100, 120), false, 'protected area untouched');
  assert.equal(t.isSolid(85, 120), true);
  assert.equal(solidCount(t), before + added);
});

test('writeRGBA converts a column-major region to row-major RGBA bytes', () => {
  const t = new Terrain(4, 3);
  t.setPixel(2, 1, packRGBA(10, 20, 30, 255));
  const out = new Uint8ClampedArray(3 * 2 * 4);
  t.writeRGBA({ x0: 1, y0: 1, x1: 4, y1: 3 }, out);
  // Pixel (2,1) is at row 0, column 1 of the region.
  assert.deepEqual([...out.slice(4, 8)], [10, 20, 30, 255]);
  assert.deepEqual([...out.slice(0, 4)], [0, 0, 0, 0]);
});

test('dirty tracking and versioning', () => {
  const t = flat();
  t.takeDirty();
  const v = t.version;
  t.carveCircle(50, 125, 10);
  const d = t.takeDirty();
  assert.ok(d && d.x0 <= 40 && d.x1 >= 60);
  assert.ok(t.version > v);
  assert.equal(t.takeDirty(), null);
});

test('generation is deterministic, bounded, with flat spawn pads for every biome', () => {
  for (const id of BIOME_IDS) {
    const a = generateTerrain(BIOMES[id], 1234);
    const b = generateTerrain(BIOMES[id], 1234);
    assert.equal(a.terrain.w, WORLD_W);
    assert.equal(a.terrain.h, WORLD_H);
    assert.deepEqual(a.spawns, b.spawns);
    assert.ok(a.terrain.px.every((v, i) => v === b.terrain.px[i]), `${id} deterministic`);
    for (let x = 0; x < WORLD_W; x += 37) {
      const s = a.terrain.surfaceY(x);
      assert.ok(s > WORLD_H * 0.2 && s < WORLD_H - BEDROCK_ROWS, `${id} surface at ${x} = ${s}`);
    }
    for (const sx of a.spawns) {
      const l = a.terrain.surfaceY(sx - 20), r = a.terrain.surfaceY(sx + 20);
      assert.ok(Math.abs(l - r) <= 2, `${id} spawn pad flat (${l} vs ${r})`);
    }
    assert.ok(a.spawns[0] < WORLD_W / 2 && a.spawns[1] > WORLD_W / 2);
    const c = generateTerrain(BIOMES[id], 999);
    assert.ok(c.terrain.px.some((v, i) => v !== a.terrain.px[i]), `${id} seeds differ`);
  }
});

test('dirt painter yields opaque colours', () => {
  const paint = makeDirtPainter(BIOMES.verdant, 7);
  for (let i = 0; i < 50; i++) assert.equal(paint(i * 13, i * 7) >>> 24, 255);
});

test('raiseMound piles a stable dome on the surface and keeps tank hulls clear', () => {
  const t = flat(300, 300, 200);
  const hull = { x0: 140, y0: 180, x1: 160, y1: 200 };
  const added = t.raiseMound(150, 80, 70, () => SOLID, [hull]);
  assert.ok(added > 3000, `added ${added}`);
  assert.ok(t.surfaceY(110) < 200 && t.surfaceY(110) > 130, 'dome rises above the old surface');
  assert.ok(t.surfaceY(150) <= 135, 'peak near the requested height');
  assert.equal(t.surfaceY(240), 200, 'outside the radius untouched');
  assert.equal(t.isSolid(150, 190), false, 'hull pocket stays clear');
  assert.equal(t.settling, false, 'mound rests on the ground, nothing collapses');
});
