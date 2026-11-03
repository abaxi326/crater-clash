import type { PlayerIndex } from './types.ts';

export interface TeamColors {
  index: PlayerIndex;
  name: string;
  primary: string;
  light: string;
  dark: string;
  glow: string;
  /** CSS custom property prefix used by the UI, e.g. var(--c-p0). */
  cssVar: string;
}

export const TEAMS: readonly [TeamColors, TeamColors] = [
  { index: 0, name: 'Azure', primary: '#3fc1ff', light: '#b5ecff', dark: '#14527a', glow: '#59d5ff', cssVar: '--c-p0' },
  { index: 1, name: 'Blaze', primary: '#ff7448', light: '#ffc6a8', dark: '#8a2a14', glow: '#ff8f5e', cssVar: '--c-p1' },
];
