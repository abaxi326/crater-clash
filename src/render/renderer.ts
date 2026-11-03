/**
 * The app's renderer: RendererCore bound to the real render modules. Sandboxes can pass
 * `factories` to swap any module for a stub.
 */
import type { TimeControl } from '../core/time.ts';
import type { RendererApi } from '../contracts.ts';
import { Background } from './background.ts';
import { RendererCore, type RenderModules, type RendererOptions } from './core/rendererCore.ts';
import { EntityRenderer } from './entities.ts';
import { Fx } from './fx.ts';
import { createPostFx } from './postfx.ts';
import { TankRenderer } from './tanks.ts';

export type { RenderModules, RendererOptions } from './core/rendererCore.ts';

export const DEFAULT_RENDER_MODULES: RenderModules = {
  background: () => new Background(),
  tanks: () => new TankRenderer(),
  entities: () => new EntityRenderer(),
  fx: hooks => new Fx(hooks),
  postfx: () => createPostFx(),
};

export class Renderer extends RendererCore implements RendererApi {
  constructor(stage: HTMLElement, time: TimeControl, options: RendererOptions = {}) {
    super(stage, time, { ...DEFAULT_RENDER_MODULES, ...options.factories });
  }
}
