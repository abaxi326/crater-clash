/**
 * Tank colour palettes: team paint stays vivid, neutral metals/rubber lean toward the biome's
 * ambient light (and darken on night biomes) so tanks sit in the scene without losing identity.
 */
import { BIOMES, type BiomeId } from '../../core/biomes.ts';
import { mixHex, shadeHex } from '../../core/color.ts';
import type { TeamColors } from '../../core/teams.ts';

export interface TankPalette {
  key: string;
  /** Team paint. */
  paint: string;
  paintLight: string;
  paintDark: string;
  paintDeep: string;
  /** Neutral gunmetal. */
  metal: string;
  metalLight: string;
  metalDark: string;
  /** Tread rubber and links. */
  rubber: string;
  link: string;
  linkLight: string;
  /** Readability outline. */
  outline: string;
  /** Specular top light and rim light. */
  spec: string;
  rim: string;
  /** Team glow (rings, lights). */
  glow: string;
  /** Headlight colour. */
  lamp: string;
  /** Night biome flag: lights read stronger, ambient darker. */
  night: boolean;
}

const cache = new Map<string, TankPalette>();

export function tankPalette(team: TeamColors, biome: BiomeId): TankPalette {
  const key = `${team.index}|${team.primary}|${biome}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const def = BIOMES[biome];
  const amb = def.palette.ambientLight;
  const night = def.timeOfDay === 'night';
  const sunset = def.timeOfDay === 'sunset';
  // Paint: a light touch of ambient, slightly deeper at night (still vivid).
  const paintMix = night ? 0.1 : sunset ? 0.1 : 0.05;
  const paintShade = night ? 0.9 : 1;
  const tint = (hex: string, k: number, shade: number): string => shadeHex(mixHex(hex, amb, k), shade);
  const metalShade = night ? 0.72 : sunset ? 0.92 : 1;
  const p: TankPalette = {
    key,
    paint: tint(team.primary, paintMix, paintShade),
    paintLight: tint(team.light, paintMix, paintShade),
    paintDark: tint(team.dark, paintMix * 0.5, paintShade),
    paintDeep: tint(shadeHex(team.dark, 0.62), 0.04, paintShade),
    metal: tint('#5d6878', 0.16, metalShade),
    metalLight: tint('#9aa6b8', 0.22, metalShade),
    metalDark: tint('#2c333f', 0.1, metalShade),
    rubber: tint('#1d2129', 0.06, metalShade),
    link: tint('#454c58', 0.14, metalShade),
    linkLight: tint('#7b8494', 0.2, metalShade),
    outline: night ? '#07080c' : '#0d1018',
    spec: mixHex('#ffffff', amb, 0.35),
    rim: night ? mixHex(amb, '#ffffff', 0.25) : mixHex('#ffffff', amb, 0.5),
    glow: team.glow,
    lamp: '#fff3c4',
    night,
  };
  cache.set(key, p);
  return p;
}

const charCache = new Map<string, TankPalette>();

/** Burnt-out variant for wrecks: paint and metals collapse to soot with a faint team hint. */
export function charPalette(pal: TankPalette): TankPalette {
  const hit = charCache.get(pal.key);
  if (hit) return hit;
  const soot = '#231d1a';
  const p: TankPalette = {
    ...pal,
    key: `${pal.key}|char`,
    paint: mixHex(soot, pal.paintDark, 0.22),
    paintLight: mixHex('#4a3f3a', pal.paint, 0.12),
    paintDark: '#191412',
    paintDeep: '#0e0b0a',
    metal: '#2e2826',
    metalLight: '#4a403b',
    metalDark: '#171312',
    rubber: '#121010',
    link: '#2a2421',
    linkLight: '#433934',
    spec: '#6a5a50',
    rim: '#8a5a40',
  };
  charCache.set(pal.key, p);
  return p;
}
