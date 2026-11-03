/**
 * Icon access for the menus. Uses the shared src/ui/icons.ts when it exists (it is written by
 * another module) and falls back to small built-in glyphs otherwise, so the menus never break
 * the page if the icon set is missing or incomplete. `setIconProvider` lets tests inject icons.
 */
import { WEAPONS, type WeaponId } from '../../core/weapons.ts';

export type UiIconName =
  | 'fire' | 'pause' | 'settings' | 'wind' | 'fuel' | 'shield' | 'heart' | 'left' | 'right' | 'up' | 'down'
  | 'grid' | 'close' | 'sound' | 'mute' | 'crate' | 'trophy' | 'cpu' | 'user' | 'play' | 'help' | 'back';

export interface IconProvider {
  ui(name: UiIconName): string;
  weapon(id: WeaponId, size?: number): string;
}

interface IconsModule {
  weaponIcon?: (id: WeaponId, size?: number) => string;
  UI_ICONS?: Partial<Record<UiIconName, string>>;
}

// Eager glob: an empty object when icons.ts does not exist (no build error), the module otherwise.
const found = import.meta.glob<IconsModule>('../icons.ts', { eager: true });
const shared: IconsModule | undefined = Object.values(found)[0];

const svg = (body: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const FALLBACK: Record<UiIconName, string> = {
  fire: svg('<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.8 2.5-5 .2 1.7 1 2.6 2 3 0-3 .3-5.6.5-8z"/>'),
  pause: svg('<rect x="6.5" y="5" width="3.5" height="14" rx="1"/><rect x="14" y="5" width="3.5" height="14" rx="1"/>'),
  settings: svg('<circle cx="12" cy="12" r="3.2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5"/>'),
  wind: svg('<path d="M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7"/>'),
  fuel: svg('<path d="M5 20V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v14M4 20h12M15 9h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V8l-3-3"/>'),
  shield: svg('<path d="M12 3 4.5 6v6c0 4.4 3.2 7.8 7.5 9 4.3-1.2 7.5-4.6 7.5-9V6z"/>'),
  heart: svg('<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>'),
  left: svg('<path d="m15 5-7 7 7 7"/>'),
  right: svg('<path d="m9 5 7 7-7 7"/>'),
  up: svg('<path d="m5 15 7-7 7 7"/>'),
  down: svg('<path d="m5 9 7 7 7-7"/>'),
  grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  sound: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>'),
  mute: svg('<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>'),
  crate: svg('<path d="M4 8 12 4l8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>'),
  trophy: svg('<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4"/>'),
  cpu: svg('<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>'),
  user: svg('<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
  play: svg('<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>'),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .9-1 1.6v.4"/><circle cx="12" cy="17" r=".6" fill="currentColor"/>'),
  back: svg('<path d="M10 6 4 12l6 6M4.5 12H20"/>'),
};

function fallbackWeapon(id: WeaponId, size = 24): string {
  const w = WEAPONS[id];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">` +
    `<circle cx="12" cy="12" r="8" fill="${w.glow}" opacity=".35"/>` +
    `<circle cx="12" cy="12" r="5.5" fill="${w.color}"/><circle cx="10" cy="10" r="2" fill="#fff" opacity=".7"/></svg>`;
}

const defaultProvider: IconProvider = {
  ui: name => shared?.UI_ICONS?.[name] ?? FALLBACK[name],
  weapon: (id, size) => {
    try {
      return shared?.weaponIcon?.(id, size) ?? fallbackWeapon(id, size);
    } catch {
      return fallbackWeapon(id, size);
    }
  },
};

let provider: IconProvider = defaultProvider;

/** Overrides the icon source (sandbox/tests). Pass null to restore the default. */
export function setIconProvider(p: IconProvider | null): void {
  provider = p ?? defaultProvider;
}

export const icon = (name: UiIconName): string => provider.ui(name);
export const weaponIcon = (id: WeaponId, size?: number): string => provider.weapon(id, size);
