/** Battlefield themes: palette, terrain shape, physics modifiers, ambience and colour grade. */

export type BiomeId = 'dunes' | 'frost' | 'lunar' | 'verdant' | 'cinder';

export type TerrainStyle = 'dunes' | 'peaks' | 'craters' | 'hills' | 'rift';
export type AmbientKind = 'dust' | 'snow' | 'stardust' | 'pollen' | 'embers';

/** Post-processing grade (applied by PostFx; approximated by the 2D fallback). */
export interface ColorGrade {
  lift: [number, number, number];   // added to shadows (-0.1..0.1)
  gamma: [number, number, number];  // mid-tone power (0.8..1.2; 1 = neutral)
  gain: [number, number, number];   // highlight multiplier (0.8..1.2)
  saturation: number;               // 1 = neutral
  contrast: number;                 // 1 = neutral
  vignette: number;                 // 0..1 strength
  bloom: number;                    // bloom strength (0..1.5)
  bloomThreshold: number;           // luminance threshold for bloom (0..1)
}

export interface BiomePalette {
  /** Sky gradient: top, middle, horizon. */
  sky: [string, string, string];
  /** Sun / planet / moon disc and its glow. */
  celestial: string;
  celestialGlow: string;
  /** Distant silhouette layers, far → near. */
  far: [string, string, string];
  /** Atmospheric haze near the horizon. */
  haze: string;
  /** Top terrain layer (sand, snow, grass, regolith, ash) and a darker variation. */
  surface: string;
  surfaceDark: string;
  /** Soil strata from shallow to deep. */
  strata: [string, string, string, string];
  bedrock: string;
  /** Lit edge highlight for terrain silhouettes. */
  rim: string;
  /** Burn-mark tint for craters. */
  scorch: string;
  /** Biome accent (magma veins, ice, flowers, planet light…). */
  accent: string;
  /** Light tint for entities so they sit in the scene. */
  ambientLight: string;
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  tagline: string;
  timeOfDay: 'day' | 'sunset' | 'night';
  celestial: 'sun' | 'planet' | 'moon';
  /** Multiplies GRAVITY. */
  gravityScale: number;
  /** Multiplies rolled wind (0 = no wind, e.g. on the Moon). */
  windScale: number;
  terrain: {
    style: TerrainStyle;
    /** Average surface height as a fraction of WORLD_H from the top. */
    base: number;
    /** Vertical relief in world units. */
    amplitude: number;
    /** 0 = smooth, 1 = very rough. */
    roughness: number;
    /** Thickness of the surface layer (sand/snow/grass) in world units. */
    surfaceDepth: number;
  };
  ambient: AmbientKind;
  palette: BiomePalette;
  grade: ColorGrade;
}

export const BIOMES: Record<BiomeId, BiomeDef> = {
  dunes: {
    id: 'dunes',
    name: 'Amber Dunes',
    tagline: 'A desert sunset that burns as hot as the shells.',
    timeOfDay: 'sunset',
    celestial: 'sun',
    gravityScale: 1,
    windScale: 1,
    terrain: { style: 'dunes', base: 0.6, amplitude: 150, roughness: 0.35, surfaceDepth: 16 },
    ambient: 'dust',
    palette: {
      sky: ['#231a4a', '#a8466b', '#ffb070'],
      celestial: '#fff1c1',
      celestialGlow: '#ff9e57',
      far: ['#d27a6c', '#a5525f', '#743553'],
      haze: '#ffb784',
      surface: '#f0b46e',
      surfaceDark: '#d9944f',
      strata: ['#c97f45', '#a9633a', '#844a30', '#5f3426'],
      bedrock: '#3a201a',
      rim: '#ffe0a3',
      scorch: '#2a120c',
      accent: '#ff8a3d',
      ambientLight: '#ffd2a8',
    },
    grade: { lift: [0.02, 0, 0.03], gamma: [1, 1, 1], gain: [1.05, 0.98, 0.92], saturation: 1.08, contrast: 1.06, vignette: 0.35, bloom: 0.75, bloomThreshold: 0.68 },
  },
  frost: {
    id: 'frost',
    name: 'Frostpeak',
    tagline: 'Thin air, deep snow and gusting mountain winds.',
    timeOfDay: 'day',
    celestial: 'sun',
    gravityScale: 1,
    windScale: 1.2,
    terrain: { style: 'peaks', base: 0.56, amplitude: 210, roughness: 0.6, surfaceDepth: 22 },
    ambient: 'snow',
    palette: {
      sky: ['#3d7bd9', '#8cc2f2', '#e6f4ff'],
      celestial: '#fffaf0',
      celestialGlow: '#fff3d6',
      far: ['#b9d3ee', '#8fb0d6', '#6788b5'],
      haze: '#eaf5ff',
      surface: '#f7fbff',
      surfaceDark: '#dbe8f5',
      strata: ['#9fb3c8', '#7d93ab', '#61768f', '#485a71'],
      bedrock: '#2a3445',
      rim: '#ffffff',
      scorch: '#1c2230',
      accent: '#8fe3ff',
      ambientLight: '#e8f2ff',
    },
    grade: { lift: [0, 0.01, 0.03], gamma: [1, 1, 1], gain: [0.96, 1, 1.06], saturation: 1, contrast: 1.04, vignette: 0.28, bloom: 0.55, bloomThreshold: 0.78 },
  },
  lunar: {
    id: 'lunar',
    name: 'Lunar Basin',
    tagline: 'Low gravity, no wind, and a long way to fall.',
    timeOfDay: 'night',
    celestial: 'planet',
    gravityScale: 0.62,
    windScale: 0,
    terrain: { style: 'craters', base: 0.62, amplitude: 110, roughness: 0.3, surfaceDepth: 10 },
    ambient: 'stardust',
    palette: {
      sky: ['#03040b', '#0a1029', '#1b2752'],
      celestial: '#4f9dff',
      celestialGlow: '#7fc4ff',
      far: ['#2a3150', '#20263f', '#171c30'],
      haze: '#3a4a80',
      surface: '#d4d7df',
      surfaceDark: '#b3b7c3',
      strata: ['#9a9eac', '#7d8191', '#626677', '#494c5c'],
      bedrock: '#25272f',
      rim: '#f2f4fa',
      scorch: '#121318',
      accent: '#9fd2ff',
      ambientLight: '#cfd8ff',
    },
    grade: { lift: [0, 0, 0.02], gamma: [1, 1, 1], gain: [0.98, 1, 1.06], saturation: 0.95, contrast: 1.12, vignette: 0.45, bloom: 0.85, bloomThreshold: 0.6 },
  },
  verdant: {
    id: 'verdant',
    name: 'Verdant Vale',
    tagline: 'Rolling meadows, blue skies, perfect for a picnic. Or a war.',
    timeOfDay: 'day',
    celestial: 'sun',
    gravityScale: 1,
    windScale: 1,
    terrain: { style: 'hills', base: 0.6, amplitude: 150, roughness: 0.4, surfaceDepth: 12 },
    ambient: 'pollen',
    palette: {
      sky: ['#2f7fe0', '#77bbf5', '#d8f0ff'],
      celestial: '#fffbe6',
      celestialGlow: '#fff4c2',
      far: ['#a3cbc6', '#72b08f', '#47906a'],
      haze: '#e2f4ff',
      surface: '#74c64a',
      surfaceDark: '#4f9e35',
      strata: ['#8f5d3b', '#764b31', '#5e3b28', '#47301f'],
      bedrock: '#2b221b',
      rim: '#c8f58a',
      scorch: '#1f1610',
      accent: '#ffd84a',
      ambientLight: '#fff8e6',
    },
    grade: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1.02, 1.02, 0.98], saturation: 1.12, contrast: 1.05, vignette: 0.25, bloom: 0.5, bloomThreshold: 0.8 },
  },
  cinder: {
    id: 'cinder',
    name: 'Cinder Rift',
    tagline: 'Ash skies over rivers of magma. Mind the glow.',
    timeOfDay: 'night',
    celestial: 'moon',
    gravityScale: 1.05,
    windScale: 0.9,
    terrain: { style: 'rift', base: 0.6, amplitude: 190, roughness: 0.55, surfaceDepth: 10 },
    ambient: 'embers',
    palette: {
      sky: ['#0b0507', '#2a0b0d', '#7a2410'],
      celestial: '#ffb48a',
      celestialGlow: '#ff5a2a',
      far: ['#3e1613', '#2e1111', '#1f0c0d'],
      haze: '#ff6a2a',
      surface: '#5a4a48',
      surfaceDark: '#463836',
      strata: ['#3d302f', '#322726', '#281f1f', '#1f1818'],
      bedrock: '#120d0d',
      rim: '#ff9a5a',
      scorch: '#0c0606',
      accent: '#ff6a1a',
      ambientLight: '#ffb08a',
    },
    grade: { lift: [0.03, 0, 0], gamma: [1, 1, 1], gain: [1.08, 0.96, 0.9], saturation: 1.1, contrast: 1.12, vignette: 0.5, bloom: 1, bloomThreshold: 0.55 },
  },
};

export const BIOME_IDS: readonly BiomeId[] = ['verdant', 'dunes', 'frost', 'cinder', 'lunar'];
