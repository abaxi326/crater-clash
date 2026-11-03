# Crater Clash — Design & Engineering Brief

An original, turn-based 2D artillery duel for the browser. Two tanks, one destructible
world, angle + power + wind. The goal is **original simplicity with modern richness**:
controls a child can learn in ten seconds, and presentation that feels like a premium
console game. Smooth 60+ fps, juicy feedback on every action, every pixel procedural.

---

## 1. Pillars

1. **Instantly readable.** Angle, power, wind, health and weapon are always clear. Team colours
   (Azure `#3fc1ff` vs Blaze `#ff7448`) are consistent across tanks, HUD, trails and numbers.
2. **Every action has a reaction.** Firing kicks the barrel and camera; impacts flash, shake,
   ripple, scorch and collapse the ground; damage numbers pop; health bars chip.
3. **Living worlds.** Five biomes with parallax skies, weather, drifting clouds that follow the
   wind, glowing craters that cool, dirt that falls, debris that bounces.
4. **Silky.** No frame hitches: pooled particles, no per-frame allocation in hot loops, no
   `shadowBlur` (pre-render glow sprites), dirty-rect terrain uploads, adaptive quality.
5. **Fair and fun.** Wind and terrain reward skill; weapons are varied but readable; the CPU is a
   believable opponent at three difficulty levels.

---

## 2. Tech & conventions (everyone)

- TypeScript (strict), Vite, Canvas 2D for the scene, WebGL2 post-processing, WebAudio. **No runtime
  dependencies; do not npm install anything.** Fonts are local (`/fonts/…`, Outfit and DM Sans).
- **Imports use explicit `.ts` extensions** (`import { clamp } from '../core/math.ts'`) and
  **`import type`** for type-only imports (`verbatimModuleSyntax`). No `enum`, `namespace` or
  constructor parameter properties (`erasableSyntaxOnly`): sim code runs natively in Node tests.
- World units = terrain pixels. World is `WORLD_W × WORLD_H` = 1920 × 1080, y grows down.
  Angles in state are **degrees, world-absolute**: 0 = right, 90 = up, 180 = left.
  Canvas rotation for a barrel is therefore `-angle * DEG`.
- The simulation (`src/sim`, `src/core`) is deterministic and DOM-free: no `Math.random()`, no
  `Date.now()`, no `window`. Use `Rng` from `core/rng.ts`. Presentation code may use `Math.random()`.
- The sim communicates outward only through `GameState` (read-only for others) and `GameEvent`s
  (`core/events.ts`). Presentation never mutates the state.
- **Contracts are in `src/contracts.ts`.** Implement your interface exactly (`implements XApi`).
  Shared data lives in `src/core/*` (read-only for module agents). If you need a contract change,
  do not edit it; work around it locally and describe the request in your final report.
- Performance rules: avoid allocations in per-frame loops (pool/reuse objects, typed arrays);
  cache gradients/paths/sprites; never use `ctx.shadowBlur`/`ctx.filter` per frame for many
  items; prefer `drawImage` of pre-rendered sprites with `globalCompositeOperation = 'lighter'` for glows.
- Comments: brief, explain *why*. Match the style of the existing files.

---

## 3. Architecture

```
            ┌──────────────── src/main.ts (app shell, loop, wiring, settings, attract mode) ───────────────┐
            │                                                                                              │
   input ──►│  Game (src/sim) ── state ──► Renderer (src/render) ──► scene canvas ──► PostFx (WebGL2) ──► │ screen
            │      │                         ├ Background  ├ TankRenderer ├ EntityRenderer ├ Fx            │
            │      └── events ──────────────►├ Camera/terrain layer/overlay (renderer.ts)                  │
            │                                ├ AudioEngine (src/audio)                                     │
            │                                └ Hud + Menus (src/ui, DOM over the canvas)                   │
            └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Frame (main.ts): `realDt = min(now - last, 0.1)` → `dt = time.step(realDt)` → `input.update(realDt)`
→ `game.update(dt)` (events dispatch synchronously to renderer/audio/hud/menus) →
`renderer.render(...)` → `audio.update(...)` → `hud.update(...)` / `menus.update(...)`.

### Module ownership

| Area | Files | Interface |
|------|-------|-----------|
| Core data & terrain (done) | `src/core/*`, `src/sim/terrain.ts`, `src/sim/terrainGen.ts`, `src/contracts.ts`, `src/ui/base.css` | — |
| Simulation | `src/sim/game.ts`, `physics.ts`, `weapons.ts`, `ai.ts`, other new `src/sim/*` | `GameApi` |
| Render core | `src/render/renderer.ts`, `camera.ts`, `terrainLayer.ts`, `decor.ts`, `overlay.ts` | `RendererApi` |
| Background | `src/render/background.ts` (+ `src/render/bg/*`) | `BackgroundApi` |
| Tanks | `src/render/tanks.ts` | `TankRendererApi` |
| Projectiles & crates | `src/render/entities.ts` (+ `src/render/entities/*`) | `EntityRendererApi` |
| Effects | `src/render/fx.ts`, `src/render/particles.ts`, `src/render/sprites.ts` (+ `src/render/fx/*`) | `FxApi` |
| Post-processing | `src/render/postfx.ts` | `createPostFx(): PostFxApi \| null` |
| Audio | `src/audio/*` | `AudioApi` |
| HUD & input | `src/ui/hud.ts`, `src/ui/hud.css`, `src/ui/input.ts`, `src/ui/icons.ts` | `HudApi`, `InputApi` |
| Menus | `src/ui/menus.ts`, `src/ui/menus.css` (+ `src/ui/menus/*`) | `MenusApi` |
| Integration | `src/main.ts` | — |

Every module may add its own **sandbox page** `sandbox/<module>.html` + `.ts` for isolated visual
testing (and its own `sandbox/<module>/*` helpers/stubs). Sandboxes are dev-only.

---

## 4. Gameplay rules (implemented by the simulation)

**Match**: first to `roundsToWin` round wins (1 / 2 / 3). Each round: fresh terrain (seed derived
from the match seed and round; `biome: 'random'` picks a new biome each round), full HP (100),
starting ammo from `startingAmmo()`, `FUEL_PER_ROUND` fuel. Round 1 starts with player 0; later
rounds start with the loser of the previous round (player 0 on a draw).

**Intro**: tanks spawn ~260 px above their spawn pads and fall in (airborne), landing with
`tankLanded { intro: true }` (no fall damage). After `INTRO_TIME` the first turn starts.

**Turn**: `turnStart` → aiming. Wind for the round's first turn is rolled in `[-MAX_WIND, MAX_WIND]`
× biome.windScale, rounded to 0.1. Each later turn the wind drifts by up to ±3 (×windScale), clamped.
The active player can: rotate the barrel (0–180°), set power (0–100), drive left/right (uses fuel;
blocked by slopes steeper than `MAX_CLIMB_SLOPE`, cannot leave `[EDGE_PADDING, WORLD_W-EDGE_PADDING]`),
select a weapon with ammo, fire. Firing decrements ammo (not Infinity), sets `recoil = 1`,
emits `fire`, spawns the projectile at `muzzlePoint(tank)` with `muzzleVelocity(angle, power)`.
Utility weapons (`instant`) apply immediately (`utility` event) and the turn proceeds to settle.

**Ballistics**: per substep (≤ `MAX_SUBSTEP`) exact constant-acceleration integration:
`a = (wind × WIND_ACCEL × weapon.windScale, gravity × weapon.gravityScale)`;
`p += v·dt + ½·a·dt²; v += a·dt`. Collision is swept along the segment (≤ 1 px samples) against
terrain and against tanks (distance to `tankCenter` < `TANK_HIT_RADIUS`). A projectile cannot hit its
own tank during its first 0.15 s. Projectiles leaving left/right/bottom beyond
`OUT_OF_BOUNDS_MARGIN` are removed (`outOfBounds`); the sky is unbounded (they fall back).

**Blast damage**: for a blast at (x, y) with radius R and damage D, each living tank at distance d
from its `tankCenter`: if `d ≤ R + TANK_HIT_RADIUS`: `dmg = round(D × (0.25 + 0.75 × (1 − max(0, d − 6) / (R + TANK_HIT_RADIUS))))`;
a direct hit (projectile contacted the tank) deals full D. Self-damage applies. Shields absorb first
(`shieldBreak` when depleted). Every damage instance emits `damage` (with `absorbed`, `hpAfter`, `by`).
HP reaching 0 → `alive = false`, `tankDestroyed`. Blasts carve `terrain.carveCircle(x, y, R, scorch=1)`
(utility/earthmaker excepted) and emit `explosion`. Blasts never push tanks directly; collapsing
terrain and falling handle the rest. Damage updates the owner's `stats.hits/damageDealt`.

**Tanks on terrain**: each step a tank checks ground under its treads (several samples across
±`TANK_HALF_WIDTH*0.7`). No support → airborne, falls with gravity; landing emits `tankLanded`
and applies fall damage beyond `FALL_DAMAGE_THRESHOLD` (`FALL_DAMAGE_PER_PX`, max `FALL_DAMAGE_MAX`).
`tilt` follows the ground slope under the treads (smoothed). If ground fills a tank's hull
(e.g. buried), the tank stays put; firing from inside dirt simply explodes there.

**Settle**: after projectiles and hazards are gone, wait until terrain has finished collapsing, all
tanks and crates rest, and at least `SETTLE_MIN_TIME` passed. Then: if a tank died → after
`ROUND_OVER_DELAY` → `roundOver` (wins++, or draw) → `matchOver` if someone reached
`roundsToWin` (never in attract mode, which auto-starts the next round after `ATTRACT_NEXT_ROUND_DELAY`).
Otherwise → `turnEnd` → maybe spawn a crate → next player's `turnStart`.

**Crates** (if enabled): at turnEnd with `CRATE_CHANCE_PER_TURN`, if fewer than `MAX_CRATES`, a
crate with a random `CRATE_WEAPONS` entry (+1 ammo, +2 for trident/starfall) parachutes from above
the world at a random x (≥ 120 px from tanks) at `CRATE_FALL_SPEED`, swaying; lands on terrain
(`crate land`), falls again if undermined. Any blast overlapping a crate (distance < R + `CRATE_SIZE`)
or a projectile touching it collects it for the blast owner (`crate collect`, ammo added).

**CPU**: plans when its turn starts: simulates candidate shots (angle × power grid then refinement)
with the real ballistics against the real terrain; picks a weapon (weighted by `aiWeight`, situational:
finisher when the target is low, burrower/seeker/sunbeam when blocked by terrain, repair below 40 HP,
aegis when the opponent has heavy weapons, avoids self-damage); applies difficulty error
(easy: big, normal: moderate and improving each turn, hard: small); may drive to a better spot.
It then *animates* its aim (barrel and power sweep smoothly toward the plan over 0.9–1.6 s with a little
overshoot) before firing, so players can watch it think. `cpuThinking` is true meanwhile.

**Controls** (human): keyboard ←/→ angle (hold to accelerate; Shift = fine 0.1 steps), ↑/↓ power,
A/D drive, Q/E or mouse wheel cycle weapon, Tab/W weapon picker, Space/Enter fire, Esc/P pause.
Pointer: drag anywhere on the battlefield to aim (direction from the turret pivot sets the angle,
distance sets power; release does NOT fire), HUD buttons for everything, full touch support.

---

## 5. Weapons

Data and exact behaviour: `src/core/weapons.ts` (each entry's comment is the behaviour spec).
Visual identity for each (projectile → trail → impact), used by entities/FX/audio:

| Weapon | Look & feel |
|---|---|
| Ember Shell | Orange-gold shell, soft smoke trail; classic fireball, smoke puff, dirt debris. |
| Thunderhead | Big dark-red shell with fire trail; two-stage blast, heavy shockwave, rock chunks, rising smoke column, strong shake + hit-stop. |
| Trident | Cyan spikes with glowing streaks; split flash with three streaks; cyan-tinted blasts. |
| Starfall | Golden orb with sparkles; star-shaped burst; starlets twinkle down, small golden pops. |
| Skipstone | Green spinning disc; green pop + dust kick per skip. |
| Ricochet | Violet orb; bright spark + metallic "ting" on every rebound; trail persists. |
| Burrower | Orange drill spike; dirt spray and rumble while tunnelling; erupts in a dirt plume. |
| Seeker | Red missile with blinking light, flame + smoke; red reticle "ping" on lock-on. |
| Magma Bloom | Molten glob; fiery blast; glowing lava blobs (light sources) that flow, sizzle and cool dark. |
| Tesla Orb | Crackling cyan orb; blue-white electric blast; jagged branching bolts to tanks each pulse. |
| Singularity | Dark violet orb with void wisps; black disc with accretion ring, lensing, particles spiralling in; implosion flash then violet blast. |
| Sunbeam | Blinking beacon; ground reticle; a colossal white-gold beam from the sky carving a trench, molten edges, big flash. |
| Earthmaker | Earthen glob; dirt burst and rising dust as the mound appears. |
| Faultline | Heavy orange shell; a ground ripple runs along the surface with dust and rock eruptions. |
| Fireworks | Pink shell with rainbow trail; multicolour radial bursts with twinkles and crackles. |
| Field Repair | Green sparkles and rising "+" glyphs around the tank; heal number. |
| Aegis Shield | Cyan hexagon bubble forms with a ripple; hits ripple it; it shatters into shards. |
| Blink Beacon | Cyan beacon; tank dissolves into particles and re-forms at the landing point. |

---

## 6. Art direction

**Overall**: painterly-vector. Clean silhouettes, rich gradients, atmospheric perspective (distant
layers lighter and closer to the sky colour), soft glows, high-contrast readable foreground.
Tanks and projectiles must pop against every biome (rim light + subtle dark outline).

**Biomes** (`src/core/biomes.ts`): Verdant Vale (bright day, fluffy clouds, birds, trees and flowers),
Amber Dunes (sunset, huge low sun, mesas, heat shimmer, dust), Frostpeak (crisp morning, snowy
peaks, pines, snowfall), Cinder Rift (night, volcano glow, lava rivers on the horizon, rising embers,
ash), Lunar Basin (space, starfield, big blue planet, low gravity, no wind, drifting stardust).

**Terrain**: textured strata (generated), plus at render time: lit rim on every exposed top edge,
a soft inner shadow under edges, scorch from craters (baked), glowing hot rims on fresh craters that
cool over ~4 s, decorations on the original surface (grass tufts, flowers, rocks, pines, cacti,
crystals per biome) that vanish (with a puff) when the ground beneath them is destroyed.

**Tanks**: chunky, friendly, detailed: segmented treads that animate with `treadPhase`, road wheels,
sloped hull with panel lines and team-colour paint, turret dome, barrel with muzzle brake,
antenna with spring sway, headlight; recoil kick; tilt with terrain; damage states (scorch decals,
sparks, smoke at < 50 HP, flames at < 25 HP); wreck when destroyed. Active tank: soft team-colour
ground ring / chevron. Size ≈ 56 × 30 world units.

**Effects**: layered explosions (flash → fireball with additive core → smoke billows → embers and
debris), shockwave rings, dynamic lights, screen flash on big hits, crater glow, dust on landing,
muzzle flash and smoke on firing, trails per weapon.

**UI**: dark glass panels (`src/ui/base.css` tokens), Outfit for display text, DM Sans for UI,
tabular numbers, rounded geometry, crisp icons (inline SVG), springy micro-animations, team colours.
Respect `html.reduced-motion`.

---

## 7. Game feel (camera & time)

- Camera fits the world to the viewport (letterbox areas show extended sky / bedrock, never black).
  When a projectile climbs above the visible top, the camera eases out (zoom down to ~0.7) to keep it
  in view, then eases back. Slow cinematic drift in attract mode.
- Shake: trauma model (`shake(t)`; offset ∝ trauma², smooth noise, small rotation), scaled by settings.
- Hit-stop 40–90 ms on heavy hits; slow motion 0.3× for ~1.4 s on a killing blow with camera focus
  (zoom ~1.35) on the destroyed tank. All disabled under reduced motion.
- Post FX: bloom (biome grade), shockwave distortion rings, chromatic pulse on big hits, vignette, grain.

---

## 8. Audio direction

Fully procedural WebAudio. Punchy, warm, not harsh. Weapon-specific fire and impact sounds
(`sound` profile), falling-shell whistle with pitch tracking speed, bounces, drill, zaps, beam roar,
crumbling dirt, tank engine while driving, wind bed scaled by |wind|, UI clicks/ticks, turn chime,
victory/defeat stingers, a calm generative music bed per biome (menu & battle moods).
Stereo pan by x position. Master/SFX/music volumes. Starts muted until the first user gesture.

---

## 9. Performance & quality tiers

Targets: 60 fps at 1080p on an integrated GPU (high), 60 fps on phones (low).
- **high**: dpr ≤ 2, post FX on (full bloom), particle cap ~3500, all ambient layers.
- **medium**: dpr ≤ 1.5, post FX on (half-res bloom), cap ~1800.
- **low**: dpr 1, post FX off, cap ~700, fewer ambient particles and decorations.
- **auto**: start high; drop a tier if the 2 s average frame time exceeds 20 ms.

---

## 10. QA hooks & tooling

- Dev server: `npm run dev` → http://127.0.0.1:5180 (already running during development).
- Screenshots / scripted play: `node scripts/shot.mjs <url> --out shots/x.png [--eval js] [--steps json] [--fps ms]`
  (see the header of `scripts/shot.mjs`). Inspect the PNGs; console errors are reported.
- `npm test` (Node test runner, `tests/*.test.ts`), `npx tsc --noEmit`, `npm run build`.
- The app shell exposes `window.__cc` and URL parameters (implemented by main.ts):
  - `?play=cpu|duel|attract` start immediately (skip menus); `&biome=<id>`; `&seed=<n>`;
    `&difficulty=easy|normal|hard`; `&weapon=<id>` (pre-select, 9 ammo); `&quality=low|medium|high`;
    `&nopost=1`; `&mute=1`; `&fps=1`.
  - `window.__cc = { game, renderer, audio, hud, menus, time, start(config), fire(angle, power, weapon?), skip(seconds), setTimeScale(n) }`.
