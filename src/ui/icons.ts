/**
 * Inline SVG icon set. Everything sits on a 24-unit grid with round 1.8 strokes in currentColor so callers
 * tint via `color`. Accent fills use `var(--icon-accent, currentColor)` at low opacity, which gives the
 * two-tone look without a second colour requirement. Weapon icons set --icon-accent to the weapon colour
 * by default (overridable by the caller's CSS).
 */
import { WEAPONS, type WeaponId } from '../core/weapons.ts';

const A = 'var(--icon-accent, currentColor)';
/** Solid accent fill. */
const fa = (o = 1): string => `fill="${A}" fill-opacity="${o}" stroke="none"`;
/** Soft accent fill plus outline. */
const soft = `fill="${A}" fill-opacity="0.28"`;

const svg = (body: string, size: number, cls: string, style = ''): string =>
  `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
  `stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"${style}>${body}</svg>`;

/** Weapon glyph bodies (24-unit grid). */
const WEAPON_PATHS: Record<WeaponId, string> = {
  // Classic shell flying up-right, with an ember tail.
  ember:
    `<path d="M9.2 14.8 15.6 8.4c1.3-1.3 3.3-2 5-2.1-.1 1.7-.8 3.7-2.1 5l-6.4 6.4z" ${soft}/>` +
    `<path d="m11.4 12.6 3.3 3.3"/>` +
    `<path d="M8 16c-1.6.2-3 1.3-3.6 3.6 2.3-.6 3.4-2 3.6-3.6z" ${fa(0.9)}/>` +
    `<path d="M5.2 13.2 3.6 12.6M10.8 18.8l.6 1.6"/>`,
  // Fat heavy round, nose up, with a bolt stamped on its body and a driving band.
  thunderhead:
    `<path d="M7.2 21.2V11.8C7.2 7.6 9.6 4.2 12 2.6c2.4 1.6 4.8 5 4.8 9.2v9.4z" ${soft}/>` +
    `<path d="M7.2 18.2h9.6"/>` +
    `<path d="m12.9 7.6-2.3 3.6h2.8l-2.3 3.6" stroke-width="1.6"/>` +
    `<path d="M4.2 14.6 2.6 13.8M19.8 14.6l1.6-.8M4.4 19.4l-1.6.4M19.6 19.4l1.6.4"/>`,
  // Three diverging spikes from one stem.
  trident:
    `<path d="M12 21.5v-8"/>` +
    `<path d="M12 13.5 6 6.5M12 13.5V4M12 13.5l6-7"/>` +
    `<path d="m12 2.2 1.8 3H10.2z" ${fa()}/>` +
    `<path d="m4.6 4.9 2.9.8-1.8 2.3z" ${fa()}/>` +
    `<path d="m19.4 4.9-2.9.8 1.8 2.3z" ${fa()}/>`,
  // A star bursting with falling starlets.
  starfall:
    `<path d="m11 2.8 1.7 3.5 3.8.5-2.8 2.7.7 3.8L11 11.5l-3.4 1.8.7-3.8-2.8-2.7 3.8-.5z" ${soft}/>` +
    `<path d="M5.5 16.2v2.6M4.2 17.5h2.6M12.5 18.5v2.6M11.2 19.8h2.6"/>` +
    `<circle cx="18.5" cy="15.5" r="1.3" ${fa()}/>` +
    `<circle cx="17" cy="21" r="0.9" ${fa(0.8)}/>`,
  // Radial firework burst.
  fireworks:
    `<circle cx="12" cy="10" r="2.2" ${fa()}/>` +
    `<path d="M12 4.2V2.6M12 17.4v-1.6M6.2 10H4.6M19.4 10h-1.6M7.9 5.9 6.8 4.8M17.2 15.2l-1.1-1.1M7.9 14.1l-1.1 1.1M17.2 4.8l-1.1 1.1"/>` +
    `<path d="M12 21.4v-1.2" stroke-dasharray="0.1 2.4"/>` +
    `<circle cx="4.5" cy="18.5" r="1" ${fa(0.8)}/><circle cx="19.5" cy="18.5" r="1" ${fa(0.8)}/>`,
  // A disc skipping across a surface with hop arcs.
  skipper:
    `<path d="M2.6 19.5h18.8" opacity="0.55"/>` +
    `<path d="M3 17.5c1.5-4 4-4 5.5 0M8.5 17.5c1.2-3 3.3-3 4.5 0" stroke-dasharray="1.6 2"/>` +
    `<ellipse cx="18" cy="13.5" rx="3.6" ry="2.4" ${soft} transform="rotate(-18 18 13.5)"/>` +
    `<path d="m16.4 13.9 3.2-1"/>`,
  // Zig-zag bank shot ending at an orb.
  ricochet:
    `<path d="M3 4.5 8.5 18 14 7l3.2 6.4" />` +
    `<path d="M2.8 21h7.4M11 3h7.2" opacity="0.55"/>` +
    `<circle cx="18.6" cy="16.4" r="2.8" ${soft}/>` +
    `<circle cx="18.6" cy="16.4" r="1" ${fa()}/>`,
  // Drill bit plunging into ground.
  burrower:
    `<path d="M2.6 13.5h5.2M16.2 13.5h5.2" opacity="0.6"/>` +
    `<path d="M8.5 2.8h7v4.4l-3.5 14-3.5-14z" ${soft}/>` +
    `<path d="m8.8 9.6 6.2-2.2M9.6 13.1l4.8-1.8M10.5 16.6l3-1.1"/>` +
    `<path d="M5.5 17.2 4 18.7M18.5 17.2l1.5 1.5"/>`,
  // Missile with a lock reticle.
  seeker:
    `<circle cx="17" cy="7" r="4.2"/>` +
    `<path d="M17 1.6v2M17 10.4v2M11.6 7h2M20.4 7h2" />` +
    `<path d="M4.2 19.8 11 13" />` +
    `<path d="m9.6 11.6 3.6-1.2-1.2 3.6z" ${fa()}/>` +
    `<path d="M3.2 17.4 5 19l1.6 1.8" />` +
    `<circle cx="17" cy="7" r="1.2" ${fa()}/>`,
  // Molten bloom: blob with drips.
  magma:
    `<path d="M12 2.8c3.7 3.4 6 6.4 6 9.7a6 6 0 0 1-12 0c0-3.3 2.3-6.3 6-9.7z" ${soft}/>` +
    `<path d="M12 9.4c1.6 1.4 2.4 2.6 2.4 3.9a2.4 2.4 0 0 1-4.8 0c0-1.3.8-2.5 2.4-3.9z" ${fa()}/>` +
    `<path d="M4.4 20.4v.1M19.6 20.4v.1M12 21.6v.1" stroke-width="2.6"/>`,
  // Charged orb with a bolt core and four arcing sparks.
  tesla:
    `<circle cx="12" cy="12" r="5.2" ${soft}/>` +
    `<path d="m12.8 8.8-2 3.4h2.6l-2 3.2" stroke-width="1.6"/>` +
    `<path d="M3.2 6.6 5 7.2l.2-1.8 1.6.8M20.8 17.4 19 16.8l-.2 1.8-1.6-.8" />` +
    `<path d="M17.6 3.4 17 5.2l1.8.2-.8 1.6M6.4 20.6 7 18.8l-1.8-.2.8-1.6" opacity="0.6"/>`,
  // Accretion ring around a void.
  singularity:
    `<ellipse cx="12" cy="12" rx="9.4" ry="3.6" transform="rotate(-24 12 12)" opacity="0.75"/>` +
    `<circle cx="12" cy="12" r="4" fill="#07060f" stroke="${A}" stroke-width="2"/>` +
    `<path d="M5.6 15.2a7.4 2.8 -24 0 0 7.4 .8" stroke-width="2.2"/>`,
  // A beam from the sky striking the ground.
  sunbeam:
    `<circle cx="12" cy="4.6" r="2.4" ${fa()}/>` +
    `<path d="M8 4.6H6.4M17.6 4.6H16M9.2 1.8l-.8-.6M14.8 1.8l.8-.6"/>` +
    `<path d="M10.2 8.6h3.6L15.4 19H8.6z" ${soft}/>` +
    `<path d="M3 19.2h18" />` +
    `<path d="M6.2 21.6 7.6 20M17.8 21.6 16.4 20"/>`,
  // Ground cracked by a travelling rift.
  faultline:
    `<path d="M2.6 11.5h4.2l2 2.6 2.4-4 2.6 5.4 2-3h5.6" />` +
    `<path d="M2.6 16.5h18.8V21H2.6z" ${soft} stroke="none"/>` +
    `<path d="M2.6 16.5h18.8"/>` +
    `<path d="m11.2 16.5.8 2.2-1 2.3M5.6 6.4l-1-2M12 5.6V3M18.4 6.4l1-2"/>`,
  // A raised mound with an up arrow.
  earthmaker:
    `<path d="M2.6 20.5c2-5.4 5-8.2 9.4-8.2s7.4 2.8 9.4 8.2z" ${soft}/>` +
    `<path d="M12 9.6V2.8M8.8 6l3.2-3.2L15.2 6"/>` +
    `<path d="M8.4 17.2h.1M14.6 16.2h.1M11.4 18.6h.1" stroke-width="2.4"/>`,
  // Wrench crossed with a plus.
  repair:
    `<path d="M14.2 4.4a4.2 4.2 0 0 0-5 5.4l-5.8 5.8a1.8 1.8 0 0 0 2.6 2.6l5.8-5.8a4.2 4.2 0 0 0 5.4-5l-2.5 2.5-2.4-.6-.6-2.4z" ${soft}/>` +
    `<path d="M18.6 14v6.8M15.2 17.4H22" stroke-width="2.2"/>`,
  // Hexagonal shield with a facet.
  aegis:
    `<path d="M12 2.4 20.2 7v10L12 21.6 3.8 17V7z" ${soft}/>` +
    `<path d="M12 7.2 16 9.5v5L12 16.8 8 14.5v-5z" />` +
    `<path d="M12 2.4v4.8M20.2 17 16 14.5M3.8 17 8 14.5" opacity="0.6"/>`,
  // Beacon with teleport arcs.
  blink:
    `<path d="M12 21.4V13" />` +
    `<path d="M9.6 21.4h4.8" />` +
    `<circle cx="12" cy="10" r="2.6" ${fa()}/>` +
    `<path d="M7.4 14.6a6.5 6.5 0 0 1 0-9.2M16.6 5.4a6.5 6.5 0 0 1 0 9.2" />` +
    `<path d="M4.6 17.4a10.4 10.4 0 0 1 0-14.8M19.4 2.6a10.4 10.4 0 0 1 0 14.8" opacity="0.5" stroke-dasharray="2 2.4"/>`,
};

const weaponCache = new Map<string, string>();

/** Crisp inline SVG for a weapon. Accent defaults to the weapon colour; the outline follows currentColor. */
export function weaponIcon(id: WeaponId, size = 24): string {
  const key = id + ':' + size;
  let out = weaponCache.get(key);
  if (!out) {
    const color = WEAPONS[id]?.color ?? '#ffffff';
    out = svg(WEAPON_PATHS[id] ?? '', size, 'ico ico-w ico-' + id, ` style="--icon-accent:${color}"`);
    weaponCache.set(key, out);
  }
  return out;
}

export type UiIconName =
  | 'fire' | 'pause' | 'settings' | 'wind' | 'fuel' | 'shield' | 'heart' | 'left' | 'right' | 'up' | 'down'
  | 'grid' | 'close' | 'sound' | 'mute' | 'crate' | 'trophy' | 'cpu' | 'user' | 'play' | 'help' | 'back';

const UI_PATHS: Record<UiIconName, string> = {
  fire:
    `<path d="M12 2.6c.6 3.2 4.8 5.1 4.8 10.2a4.8 4.8 0 0 1-9.6 0c0-2.2 1-3.7 2.1-4.8.2 1.6.9 2.6 2 3.1-.6-3.2-.2-6 .7-8.5z" ${soft}/>` +
    `<path d="M12 13.4c.9.9 1.6 1.8 1.6 2.9a1.6 1.6 0 0 1-3.2 0c0-1.1.7-2 1.6-2.9z" ${fa()}/>`,
  pause: `<rect x="6.4" y="4.8" width="3.8" height="14.4" rx="1.2" ${soft}/><rect x="13.8" y="4.8" width="3.8" height="14.4" rx="1.2" ${soft}/>`,
  settings:
    `<path d="M10.3 2.8h3.4l.5 2.4 1.7 1 2.3-.8 1.7 2.9-1.8 1.6v2l1.8 1.6-1.7 2.9-2.3-.8-1.7 1-.5 2.4h-3.4l-.5-2.4-1.7-1-2.3.8-1.7-2.9L5.6 13v-2L3.8 9.3l1.7-2.9 2.3.8 1.7-1z" ${soft}/>` +
    `<circle cx="12" cy="12" r="2.8"/>`,
  wind:
    `<path d="M3 8.6h10.4a2.6 2.6 0 1 0-2.6-2.6"/>` +
    `<path d="M3 12.4h15.2a2.8 2.8 0 1 1-2.8 2.8"/>` +
    `<path d="M3 16.2h6.4"/>`,
  fuel:
    `<path d="M5 20.8V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15.8z" ${soft}/>` +
    `<path d="M3.6 20.8h12.8M7.6 7.2h4.8"/>` +
    `<path d="M15 9.6h1.6a1.6 1.6 0 0 1 1.6 1.6v5.2a1.4 1.4 0 0 0 2.8 0V8.2l-2.4-2.6"/>`,
  shield: `<path d="M12 2.8 19.6 5.6v5.8c0 4.6-3.2 8.2-7.6 9.8-4.4-1.6-7.6-5.2-7.6-9.8V5.6z" ${soft}/><path d="m9 12 2.2 2.2L15.4 10"/>`,
  heart: `<path d="M12 20.4S3.2 15.2 3.2 9a4.6 4.6 0 0 1 8.8-1.9A4.6 4.6 0 0 1 20.8 9c0 6.2-8.8 11.4-8.8 11.4z" ${soft}/>`,
  left: `<path d="M14.6 5.4 8 12l6.6 6.6"/>`,
  right: `<path d="M9.4 5.4 16 12l-6.6 6.6"/>`,
  up: `<path d="M5.4 14.6 12 8l6.6 6.6"/>`,
  down: `<path d="M5.4 9.4 12 16l6.6-6.6"/>`,
  grid:
    `<rect x="3.6" y="3.6" width="7" height="7" rx="1.8" ${soft}/><rect x="13.4" y="3.6" width="7" height="7" rx="1.8"/>` +
    `<rect x="3.6" y="13.4" width="7" height="7" rx="1.8"/><rect x="13.4" y="13.4" width="7" height="7" rx="1.8" ${soft}/>`,
  close: `<path d="M6 6l12 12M18 6 6 18"/>`,
  sound:
    `<path d="M4 9.4h3.4L12 5.2v13.6l-4.6-4.2H4z" ${soft}/>` +
    `<path d="M15.4 9a4.2 4.2 0 0 1 0 6M18 6.4a8 8 0 0 1 0 11.2"/>`,
  mute: `<path d="M4 9.4h3.4L12 5.2v13.6l-4.6-4.2H4z" ${soft}/><path d="m15.6 9.4 5 5.2M20.6 9.4l-5 5.2"/>`,
  crate:
    `<path d="M3.6 7.6 12 3.4l8.4 4.2v8.8L12 20.6l-8.4-4.2z" ${soft}/>` +
    `<path d="M3.6 7.6 12 11.8l8.4-4.2M12 11.8v8.8M7.8 5.5l8.4 4.2"/>`,
  trophy:
    `<path d="M7.2 3.6h9.6v5.6a4.8 4.8 0 0 1-9.6 0z" ${soft}/>` +
    `<path d="M7.2 5.6H4.4a3 3 0 0 0 3.2 4.6M16.8 5.6h2.8a3 3 0 0 1-3.2 4.6M12 14v3.4M8.4 20.4h7.2M9.6 17.4h4.8v3H9.6z"/>`,
  cpu:
    `<rect x="6" y="6" width="12" height="12" rx="2.4" ${soft}/>` +
    `<rect x="9.4" y="9.4" width="5.2" height="5.2" rx="1"/>` +
    `<path d="M9.4 2.8V6M14.6 2.8V6M9.4 18v3.2M14.6 18v3.2M2.8 9.4H6M2.8 14.6H6M18 9.4h3.2M18 14.6h3.2"/>`,
  user: `<circle cx="12" cy="8.2" r="4" ${soft}/><path d="M4.4 20.6c.8-4 3.8-6.2 7.6-6.2s6.8 2.2 7.6 6.2"/>`,
  play: `<path d="M7.4 4.6v14.8a1 1 0 0 0 1.5.9l11.4-7.4a1 1 0 0 0 0-1.8L8.9 3.7a1 1 0 0 0-1.5.9z" ${soft}/>`,
  help:
    `<circle cx="12" cy="12" r="9" ${soft}/>` +
    `<path d="M9.4 9.4a2.7 2.7 0 0 1 5.2.9c0 1.8-2.6 2.3-2.6 4"/><path d="M12 17.4v.1" stroke-width="2.4"/>`,
  back: `<path d="M9.6 5.4 3.6 11.4l6 6"/><path d="M4 11.4h10.4a6 6 0 0 1 6 6v1.2"/>`,
};

/** UI icons at the default 24 px; scale with CSS width/height (they use viewBox). */
export const UI_ICONS: Record<UiIconName, string> = (() => {
  const out = {} as Record<UiIconName, string>;
  for (const k of Object.keys(UI_PATHS) as UiIconName[]) out[k] = svg(UI_PATHS[k], 24, 'ico ico-' + k);
  return out;
})();
