# Crater Clash

An original turn-based artillery duel for the browser. Two tanks, one destructible world: set your angle and power, read the wind, and fire.

Built with TypeScript, Canvas 2D, WebGL2 post-processing and WebAudio. There are no runtime dependencies, and every pixel and sound is generated procedurally.

> **Status:** in active development. Integration and polish passes are ongoing.

## Features

- **Destructible terrain.** Explosions carve pixel-perfect craters with scorched, glowing rims, and unsupported ground collapses and settles.
- **18 weapons:**
  - **Standard shells:** Ember Shell, Thunderhead.
  - **Clusters:** Trident, Starfall, Fireworks.
  - **Trick shots:** Skipstone, Ricochet, Burrower, Seeker.
  - **Elemental:** Magma Bloom, Tesla Orb, Singularity, the Sunbeam orbital strike, Faultline.
  - **Utility:** Earthmaker, Field Repair, Aegis Shield, Blink Beacon.
- **5 battlefields**, each with its own mood and physics: Verdant Vale, Amber Dunes, Frostpeak, Cinder Rift, and Lunar Basin (low gravity, no wind).
- **Modes:** play against the CPU (Easy, Normal or Hard) or a local two-player duel. Matches are first-to-N rounds, with parachute supply crates.
- **Presentation:** bloom, shockwave distortion, dynamic lights, layered particle explosions, a slow-motion kill-cam, parallax skies and weather, and procedural music and sound effects.

## Quick start

Requires Node.js 22.18+ or 24.

```sh
npm install
npm run dev        # http://127.0.0.1:5180
```

| Command | Purpose |
|---|---|
| `npm run build` | Type-check and build static files into `dist/` (host anywhere) |
| `npm run preview` | Serve the production build |
| `npm test` | Simulation and terrain test suite (Node's built-in test runner) |

## Run with Docker

The image builds the game with Node, then serves the static files with nginx. You only need Docker for this, not Node.

```sh
docker compose up --build -d     # build and start: http://localhost:8080
docker compose logs -f           # follow logs
docker compose down              # stop and remove
```

Without Compose:

```sh
docker build -t crater-clash .
docker run --rm -p 8080:80 crater-clash
```

To use another host port, change `8080` in `compose.yaml` or in the `-p` flag.

## Controls

| Action | Keyboard | Mouse / touch |
|---|---|---|
| Aim | ← → (hold Shift for fine steps) | Drag on the battlefield |
| Power | ↑ ↓ | Drag distance, mouse wheel |
| Drive | A D | ◀ ▶ buttons (uses fuel) |
| Weapon | Q E, Tab for the picker | Weapon button |
| Fire | Space or Enter | FIRE |
| Pause | Esc or P | Pause button |

## Project layout

| Path | Contents |
|---|---|
| `src/core` | Shared data model: weapons, biomes, events, settings |
| `src/sim` | Deterministic simulation: bitmap terrain, ballistics, weapons, CPU opponent |
| `src/render` | Renderer, camera, background, tanks, projectiles, effects, WebGL post-FX |
| `src/audio` | Procedural WebAudio sound effects and music |
| `src/ui` | HUD, menus, input |
| `DESIGN.md` | Design and engineering brief |
| `scripts/` | Headless-Chrome screenshot and playtest harnesses (development) |
| `sandbox/` | Isolated test pages for individual modules (development) |

## Credits

Fonts: [Outfit](https://github.com/Outfitio/Outfit-Fonts) and [DM Sans](https://github.com/googlefonts/dm-fonts), both under the SIL Open Font License (see `public/fonts`).
