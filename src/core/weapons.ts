/**
 * The arsenal. This file is the single source of truth for weapon data; behaviour
 * lives in src/sim/weapons.ts, visuals in src/render, sounds in src/audio, all keyed by id.
 * Behaviour notes on each entry describe exactly what the simulation must do.
 */

export type WeaponId =
  | 'ember' | 'thunderhead' | 'trident' | 'starfall' | 'skipper' | 'ricochet'
  | 'burrower' | 'seeker' | 'magma' | 'tesla' | 'singularity' | 'sunbeam'
  | 'earthmaker' | 'faultline' | 'fireworks' | 'repair' | 'aegis' | 'blink';

export type WeaponCategory = 'shell' | 'cluster' | 'trick' | 'elemental' | 'terrain' | 'utility';
export type ProjectileStyle = 'shell' | 'heavy' | 'spike' | 'orb' | 'disc' | 'missile' | 'glob' | 'beacon' | 'none';
export type TrailStyle = 'smoke' | 'fire' | 'glow' | 'spark' | 'electric' | 'void' | 'rainbow' | 'none';
export type ExplosionKind = 'standard' | 'heavy' | 'small' | 'electric' | 'fire' | 'void' | 'beam' | 'dirt' | 'firework' | 'none';
export type SoundProfile = 'thump' | 'boom' | 'heavy' | 'pop' | 'zap' | 'whoosh' | 'chime' | 'drill';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** Short punchy line for UI cards. */
  tagline: string;
  description: string;
  category: WeaponCategory;
  /** Ammo at the start of each round; Infinity = unlimited. */
  ammo: number;
  /** Peak damage of the primary blast (direct hit). 0 = harmless. */
  damage: number;
  /** Primary blast / crater radius (world units). */
  radius: number;
  /** Main colour and glow colour (hex), shared by projectile, effects and UI. */
  color: string;
  glow: string;
  projectile: { style: ProjectileStyle; size: number; trail: TrailStyle; spin?: boolean };
  /** Multipliers applied to gravity and wind while this weapon's projectiles fly. */
  gravityScale: number;
  windScale: number;
  explosion: ExplosionKind;
  sound: SoundProfile;
  /** Utility weapons resolve instantly without a projectile (and still use the turn). */
  instant: boolean;
  /** Can be found inside supply crates. */
  inCrates: boolean;
  /** Relative preference for the CPU opponent (0 = CPU uses special logic or never). */
  aiWeight: number;
  /** Behaviour tuning; each key is documented in the entry's comment. */
  params: Readonly<Record<string, number>>;
}

type Def = Omit<WeaponDef, 'id'>;
const W = <T extends Record<WeaponId, Def>>(defs: T): Record<WeaponId, WeaponDef> => {
  const out = {} as Record<WeaponId, WeaponDef>;
  for (const id of Object.keys(defs) as WeaponId[]) out[id] = { id, ...defs[id] };
  return out;
};

export const WEAPONS: Record<WeaponId, WeaponDef> = W({
  /** Plain ballistic shell. */
  ember: {
    name: 'Ember Shell', tagline: 'Old reliable', category: 'shell',
    description: 'A dependable high-explosive round. Never runs out.',
    ammo: Infinity, damage: 30, radius: 42, color: '#ffb347', glow: '#ff7a1a',
    projectile: { style: 'shell', size: 5, trail: 'smoke' }, gravityScale: 1, windScale: 1,
    explosion: 'standard', sound: 'boom', instant: false, inCrates: false, aiWeight: 1, params: {},
  },
  /** Heavy ballistic shell: bigger blast, slightly heavier and less affected by wind. */
  thunderhead: {
    name: 'Thunderhead', tagline: 'Bring the house down', category: 'shell',
    description: 'A dense, heavy round. Enormous blast, enormous crater.',
    ammo: 2, damage: 50, radius: 78, color: '#ff5a36', glow: '#ff2d12',
    projectile: { style: 'heavy', size: 8, trail: 'fire' }, gravityScale: 1.08, windScale: 0.8,
    explosion: 'heavy', sound: 'heavy', instant: false, inCrates: true, aiWeight: 1.6, params: {},
  },
  /**
   * At the apex (vy changes from negative to non-negative) the shell is replaced by `fragments`
   * fragment shells at the same position; fragment i gets vx += (i - (n-1)/2) * spread and keeps vy.
   * Each fragment explodes on contact with full `damage`/`radius`.
   */
  trident: {
    name: 'Trident', tagline: 'Three for one', category: 'cluster',
    description: 'Splits into three diverging shells at the top of its arc.',
    ammo: 3, damage: 22, radius: 34, color: '#6ff3ff', glow: '#19d3ff',
    projectile: { style: 'spike', size: 5, trail: 'glow' }, gravityScale: 1, windScale: 1,
    explosion: 'standard', sound: 'pop', instant: false, inCrates: true, aiWeight: 1.2,
    params: { fragments: 3, spread: 75 },
  },
  /**
   * At the apex bursts into `fragments` starlets: fragment i gets
   * vx += (i - (n-1)/2) * spread + small deterministic jitter, vy = -upKick * (0.6..1).
   * Each starlet: `damage`/`radius` small blasts (explosion kind 'small').
   */
  starfall: {
    name: 'Starfall', tagline: 'Make a wish', category: 'cluster',
    description: 'Bursts at its peak into a glittering rain of nine starlets.',
    ammo: 2, damage: 12, radius: 24, color: '#ffe66d', glow: '#fff3b0',
    projectile: { style: 'orb', size: 6, trail: 'spark' }, gravityScale: 1, windScale: 1,
    explosion: 'small', sound: 'pop', instant: false, inCrates: true, aiWeight: 1.1,
    params: { fragments: 9, spread: 46, upKick: 60 },
  },
  /**
   * On ground contact (not a tank) while bounces < `bounces`: small blast (bounceDamage, bounceRadius,
   * explosion kind 'small'), then bounce: vy = -|vy| * restitution, vx *= friction. Final contact or any
   * tank contact: full blast.
   */
  skipper: {
    name: 'Skipstone', tagline: 'Hop, skip, kaboom', category: 'trick',
    description: 'Skips off the ground up to three times, popping on every bounce.',
    ammo: 3, damage: 32, radius: 42, color: '#a6ff6e', glow: '#5dff3a',
    projectile: { style: 'disc', size: 6, trail: 'glow', spin: true }, gravityScale: 1, windScale: 1,
    explosion: 'standard', sound: 'pop', instant: false, inCrates: false, aiWeight: 0.7,
    params: { bounces: 3, bounceDamage: 9, bounceRadius: 18, restitution: 0.62, friction: 0.82 },
  },
  /**
   * Reflects its velocity about the terrain surface normal (v' = (v - 2(v·n)n) * restitution) with no blast,
   * up to `bounces` times; detonates on the next terrain contact after that, or on any tank contact.
   */
  ricochet: {
    name: 'Ricochet', tagline: 'Bank it in', category: 'trick',
    description: 'Rebounds off the terrain up to four times before detonating. Trick-shot heaven.',
    ammo: 2, damage: 34, radius: 38, color: '#d29bff', glow: '#a259ff',
    projectile: { style: 'orb', size: 6, trail: 'glow' }, gravityScale: 1, windScale: 1,
    explosion: 'standard', sound: 'zap', instant: false, inCrates: false, aiWeight: 0.6,
    params: { bounces: 4, restitution: 0.8 },
  },
  /**
   * On terrain contact switches to drill mode: keeps its current direction at `drillSpeed` (no gravity/wind),
   * carving a tunnel of `tunnelRadius`. Detonates after travelling `drillDistance` underground, when it
   * pops back out into open air after >20 px of drilling, on tank contact, or on reaching bedrock.
   */
  burrower: {
    name: 'Burrower', tagline: 'Dig deep', category: 'trick',
    description: 'Drills through solid ground, then erupts from below. Hills are no shelter.',
    ammo: 2, damage: 42, radius: 56, color: '#e8a85a', glow: '#ffb35c',
    projectile: { style: 'spike', size: 6, trail: 'smoke' }, gravityScale: 1, windScale: 1,
    explosion: 'heavy', sound: 'drill', instant: false, inCrates: true, aiWeight: 1,
    params: { drillDistance: 170, tunnelRadius: 9, drillSpeed: 260 },
  },
  /**
   * Ballistic until the apex, then homes: rotates its velocity toward the enemy tank centre by at most
   * `turnRate` rad/s, keeping speed (gravity no longer applies while homing; wind does not apply).
   */
  seeker: {
    name: 'Seeker', tagline: 'It knows where you live', category: 'trick',
    description: 'After reaching its peak, locks on and steers toward the enemy.',
    ammo: 2, damage: 36, radius: 40, color: '#ff4d6d', glow: '#ff1f4b',
    projectile: { style: 'missile', size: 6, trail: 'fire' }, gravityScale: 1, windScale: 1,
    explosion: 'standard', sound: 'boom', instant: false, inCrates: true, aiWeight: 1.3,
    params: { turnRate: 2.6 },
  },
  /**
   * Impact blast (kind 'fire') plus `droplets` lava hazards sprayed upward (vx ±160, vy -120..-320).
   * Lava falls ballistically, then slides downhill along the surface and comes to rest in hollows.
   * Each droplet touching a tank deals `dropletDamage` at most once per `tickInterval`. After `lavaLife`
   * seconds it cools into a small basalt blob (terrain fill, radius 3).
   */
  magma: {
    name: 'Magma Bloom', tagline: 'The floor is lava', category: 'elemental',
    description: 'Splashes molten rock that flows downhill and scorches anything it touches.',
    ammo: 2, damage: 14, radius: 30, color: '#ff6a00', glow: '#ffb000',
    projectile: { style: 'glob', size: 7, trail: 'fire' }, gravityScale: 1, windScale: 1,
    explosion: 'fire', sound: 'boom', instant: false, inCrates: true, aiWeight: 1.1,
    params: { droplets: 16, dropletDamage: 3, lavaLife: 4.5, tickInterval: 0.3 },
  },
  /**
   * Impact blast (kind 'electric') plus a 'tesla' hazard at the impact point. Every `pulseInterval` s,
   * `pulses` times: emits a 'lightning' event to every tank within `arcRange` (dealing `arcDamage`,
   * ignoring terrain cover) and 2–3 cosmetic ground arcs.
   */
  tesla: {
    name: 'Tesla Orb', tagline: 'Shockingly effective', category: 'elemental',
    description: 'Charges up on impact, arcing lightning into every tank nearby. Cover will not help.',
    ammo: 2, damage: 10, radius: 26, color: '#7af0ff', glow: '#38b6ff',
    projectile: { style: 'orb', size: 7, trail: 'electric' }, gravityScale: 1, windScale: 1,
    explosion: 'electric', sound: 'zap', instant: false, inCrates: true, aiWeight: 1,
    params: { arcRange: 210, arcDamage: 9, pulses: 3, pulseInterval: 0.38 },
  },
  /**
   * On impact opens a 'singularity' hazard (10 px above the impact point) for `duration` s. Its radius grows
   * to `maxRadius` (ease-out), carving terrain every step. Tanks within `pullRadius` slide toward it at up
   * to `pullSpeed` px/s (stopping at obstacles too steep to climb). At the end it collapses: blast with
   * `damage`/`radius` (kind 'void').
   */
  singularity: {
    name: 'Singularity', tagline: 'Lights out', category: 'elemental',
    description: 'Opens a tiny black hole that devours the ground around it, then collapses.',
    ammo: 1, damage: 44, radius: 50, color: '#b388ff', glow: '#7c4dff',
    projectile: { style: 'orb', size: 8, trail: 'void' }, gravityScale: 0.9, windScale: 0.6,
    explosion: 'void', sound: 'whoosh', instant: false, inCrates: true, aiWeight: 1.2,
    params: { duration: 1.6, maxRadius: 76, pullRadius: 230, pullSpeed: 46 },
  },
  /**
   * The beacon lands and plants itself; a 'beam' hazard charges for `chargeTime` s, then fires for
   * `beamTime` s: carves the column [x - halfWidth, x + halfWidth] from the top of the world down to
   * (surface + depth), progressively. Tanks whose hull overlaps the column take `damage` once
   * (scaled 0.5..1 by overlap).
   */
  sunbeam: {
    name: 'Sunbeam', tagline: 'Call it down', category: 'elemental',
    description: 'Marks the ground where it lands. Moments later a beam from orbit carves a deep trench.',
    ammo: 1, damage: 56, radius: 26, color: '#fff27a', glow: '#ffd400',
    projectile: { style: 'beacon', size: 5, trail: 'glow' }, gravityScale: 1, windScale: 1,
    explosion: 'beam', sound: 'chime', instant: false, inCrates: true, aiWeight: 1.3,
    params: { chargeTime: 0.9, beamTime: 0.75, halfWidth: 26, depth: 240 },
  },
  /**
   * On impact fills air inside a circle of `moundRadius` centred on the impact point with loose dirt (never
   * inside tank hulls); the unsupported part then collapses naturally into a mound. No damage.
   */
  earthmaker: {
    name: 'Earthmaker', tagline: 'Build a wall', category: 'terrain',
    description: 'Raises a towering heap of earth. Block a shot, or bury a rival.',
    ammo: 2, damage: 0, radius: 92, color: '#d2a86b', glow: '#f0c98a',
    projectile: { style: 'glob', size: 7, trail: 'smoke' }, gravityScale: 1, windScale: 1,
    explosion: 'dirt', sound: 'thump', instant: false, inCrates: false, aiWeight: 0.4,
    params: { moundRadius: 92 },
  },
  /**
   * Impact blast plus a 'quake' hazard: a seismic front travels along the surface in both directions at
   * `waveSpeed`; every `spacing` px it triggers an eruption blast at the surface (eruptionDamage,
   * eruptionRadius, kind 'small'), `eruptions` per side.
   */
  faultline: {
    name: 'Faultline', tagline: 'Feel the ground shake', category: 'elemental',
    description: 'Sends a seismic wave rippling across the surface, erupting as it goes.',
    ammo: 2, damage: 16, radius: 30, color: '#ffa26b', glow: '#ff7b29',
    projectile: { style: 'heavy', size: 7, trail: 'smoke' }, gravityScale: 1, windScale: 1,
    explosion: 'standard', sound: 'heavy', instant: false, inCrates: true, aiWeight: 1,
    params: { eruptions: 4, spacing: 60, eruptionDamage: 14, eruptionRadius: 26, waveSpeed: 420 },
  },
  /**
   * Impact blast (kind 'firework') plus `stars` star fragments flung outward and upward at `starSpeed`
   * (angles spread over the upper half-circle); each explodes after `starDelay` s or on contact with
   * `starDamage`/`starRadius`, each tinted a different hue (data.hue).
   */
  fireworks: {
    name: 'Fireworks', tagline: 'Grand finale', category: 'cluster',
    description: 'Explodes in a dazzling multicolour burst of crackling stars.',
    ammo: 2, damage: 18, radius: 28, color: '#ff6bd6', glow: '#ff3fb8',
    projectile: { style: 'shell', size: 6, trail: 'rainbow' }, gravityScale: 1, windScale: 1,
    explosion: 'firework', sound: 'pop', instant: false, inCrates: true, aiWeight: 0.9,
    params: { stars: 7, starDamage: 8, starRadius: 18, starDelay: 0.5, starSpeed: 300 },
  },
  /** Instantly heals `heal` (capped at maxHp). Uses the turn. */
  repair: {
    name: 'Field Repair', tagline: 'Patch it up', category: 'utility',
    description: 'Restores 30 hull points. Uses your turn.',
    ammo: 1, damage: 0, radius: 0, color: '#5dff9b', glow: '#22ff7a',
    projectile: { style: 'none', size: 0, trail: 'none' }, gravityScale: 1, windScale: 1,
    explosion: 'none', sound: 'chime', instant: true, inCrates: true, aiWeight: 0, params: { heal: 30 },
  },
  /** Instantly adds `shield` points (absorbed before hp, lasts the round, does not stack above 60). Uses the turn. */
  aegis: {
    name: 'Aegis Shield', tagline: 'Not today', category: 'utility',
    description: 'Projects an energy barrier that absorbs the next 45 damage. Uses your turn.',
    ammo: 1, damage: 0, radius: 0, color: '#6ee7ff', glow: '#3dd8ff',
    projectile: { style: 'none', size: 0, trail: 'none' }, gravityScale: 1, windScale: 1,
    explosion: 'none', sound: 'chime', instant: true, inCrates: true, aiWeight: 0, params: { shield: 45 },
  },
  /**
   * Fires a beacon; where it first touches terrain the firing tank teleports (to the surface at that x,
   * clamped to the playable area). Off-world beacons fizzle. Touching a tank also fizzles.
   */
  blink: {
    name: 'Blink Beacon', tagline: 'Now you see me', category: 'utility',
    description: 'Fire a beacon and warp your tank to wherever it lands.',
    ammo: 1, damage: 0, radius: 0, color: '#a0ffef', glow: '#4dfff0',
    projectile: { style: 'beacon', size: 5, trail: 'glow' }, gravityScale: 1, windScale: 1,
    explosion: 'none', sound: 'whoosh', instant: false, inCrates: true, aiWeight: 0, params: {},
  },
});

/** Display order for pickers. */
export const WEAPON_ORDER: readonly WeaponId[] = [
  'ember', 'thunderhead', 'trident', 'starfall', 'fireworks',
  'skipper', 'ricochet', 'burrower', 'seeker',
  'magma', 'tesla', 'singularity', 'sunbeam', 'faultline',
  'earthmaker', 'repair', 'aegis', 'blink',
];

export const CRATE_WEAPONS: readonly WeaponId[] = WEAPON_ORDER.filter(id => WEAPONS[id].inCrates);

export function startingAmmo(): Record<WeaponId, number> {
  const ammo = {} as Record<WeaponId, number>;
  for (const id of WEAPON_ORDER) ammo[id] = WEAPONS[id].ammo;
  return ammo;
}
