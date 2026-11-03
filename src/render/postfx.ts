/**
 * WebGL2 post-processing: bloom (soft-knee bright pass + dual-Kawase pyramid), shockwave
 * refraction rings, chromatic aberration, colour grade, flash, vignette, grain and dither.
 *
 * The renderer draws the scene into a 2D canvas; `render()` uploads it as a texture and
 * composites to this module's own canvas. Nothing is allocated per frame. Context loss is
 * survived: rendering stops until `webglcontextrestored`, then every resource is rebuilt.
 */
import type { PostFxApi, PostFxFrame } from '../contracts.ts';
import type { Quality } from '../core/settings.ts';
import { BRIGHT_FRAG, COMPOSITE_FRAG, DOWN_FRAG, MAX_SHOCKWAVES, UP_FRAG, VERT } from './postfx/shaders.ts';

/** Bloom pyramid depth (levels below the half-res bright pass) per quality tier. */
const LEVELS: Record<Quality, number> = { high: 4, medium: 3, low: 2 };
const MAX_LEVELS = 4;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

interface Prog {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

/** All GL objects; rebuilt from scratch after a context loss. */
interface Resources {
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
  bright: Prog;
  down: Prog;
  up: Prog;
  composite: Prog;
  scene: WebGLTexture;
  /** levels[0] = half-res bright pass, each next level half the previous. */
  levels: Target[];
  /** Internal format used for the bloom chain (RGBA16F when renderable, else RGBA8). */
  hdr: boolean;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    console.warn('[postfx] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, frag: string, uniforms: readonly string[]): Prog | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, frag);
  const program = gl.createProgram();
  if (!vs || !fs || !program) return null;
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.bindAttribLocation(program, 0, 'aPos');
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    if (!gl.isContextLost()) console.warn('[postfx] program link failed:', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  const u: Record<string, WebGLUniformLocation | null> = {};
  for (const name of uniforms) u[name] = gl.getUniformLocation(program, name);
  return { program, u };
}

function makeTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const tex = gl.createTexture();
  if (!tex) return null;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** (Re)specifies a render-target texture's storage. */
function allocTarget(gl: WebGL2RenderingContext, t: Target, w: number, h: number, hdr: boolean): void {
  t.w = w;
  t.h = h;
  gl.bindTexture(gl.TEXTURE_2D, t.tex);
  if (hdr) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
  else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
}

function makeTarget(gl: WebGL2RenderingContext, hdr: boolean): Target | null {
  const tex = makeTexture(gl);
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) return null;
  const t: Target = { tex, fbo, w: 0, h: 0 };
  allocTarget(gl, t, 4, 4, hdr);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!ok) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    return null;
  }
  return t;
}

const BRIGHT_U = ['uSrc', 'uTexel', 'uThreshold', 'uKnee'] as const;
const DOWN_U = ['uSrc', 'uTexel'] as const;
const UP_U = ['uSrc', 'uTexel', 'uWeight'] as const;
const COMPOSITE_U = [
  'uScene', 'uBloom', 'uBloomTexel', 'uSize', 'uAspect', 'uShock', 'uShockStr', 'uShockCount',
  'uChroma', 'uBloomAmt', 'uLift', 'uInvGamma', 'uGain', 'uSaturation', 'uContrast', 'uFlash',
  'uVignette', 'uGrain', 'uTime',
] as const;

function buildResources(gl: WebGL2RenderingContext): Resources | null {
  const bright = link(gl, BRIGHT_FRAG, BRIGHT_U);
  const down = link(gl, DOWN_FRAG, DOWN_U);
  const up = link(gl, UP_FRAG, UP_U);
  const composite = link(gl, COMPOSITE_FRAG, COMPOSITE_U);
  if (!bright || !down || !up || !composite) return null;

  // One VAO holding a single oversized triangle that covers the viewport.
  const vao = gl.createVertexArray();
  const vbo = gl.createBuffer();
  if (!vao || !vbo) return null;
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const scene = makeTexture(gl);
  if (!scene) return null;

  // Half-float bloom chain when colour-renderable (wider range, no banding in soft halos).
  const hdrExt = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
  let hdr = hdrExt;
  const levels: Target[] = [];
  for (let i = 0; i <= MAX_LEVELS; i++) {
    let t = makeTarget(gl, hdr);
    if (!t && hdr && i === 0) {
      hdr = false;
      t = makeTarget(gl, hdr);
    }
    if (!t) return null;
    levels.push(t);
  }

  // Scene upload state: straight alpha, no flip (row 0 = top), no colour-space conversion.
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.DITHER);
  gl.blendFunc(gl.ONE, gl.ONE);

  // Sampler units never change: scene/src on 0, bloom on 1.
  gl.useProgram(composite.program);
  gl.uniform1i(composite.u.uScene, 0);
  gl.uniform1i(composite.u.uBloom, 1);
  for (const p of [bright, down, up]) {
    gl.useProgram(p.program);
    gl.uniform1i(p.u.uSrc, 0);
  }
  gl.useProgram(null);

  return { vao, vbo, bright, down, up, composite, scene, levels, hdr };
}

class PostFx implements PostFxApi {
  readonly canvas: HTMLCanvasElement;
  private readonly gl: WebGL2RenderingContext;
  private res: Resources | null = null;
  private lost = false;
  private width = 1;
  private height = 1;
  private srcW = 0;
  private srcH = 0;
  private disposed = false;
  // Preallocated uniform staging (render() must not allocate).
  private readonly shock = new Float32Array(MAX_SHOCKWAVES * 4);
  private readonly shockStr = new Float32Array(MAX_SHOCKWAVES);

  constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
  }

  /** Builds GL resources; false if anything required is missing. */
  init(): boolean {
    try {
      this.res = buildResources(this.gl);
    } catch (err) {
      console.warn('[postfx] init failed:', err);
      this.res = null;
    }
    this.srcW = this.srcH = 0;
    if (this.res) this.allocLevels();
    return this.res !== null;
  }

  /** True while the pipeline can draw (false during context loss or after a failed restore). */
  get active(): boolean {
    return !this.lost && !this.disposed && this.res !== null;
  }

  /** Whether the bloom chain runs in half-float. */
  get hdr(): boolean {
    return this.res?.hdr ?? false;
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault(); // allows restoration
    this.lost = true;
    this.res = null; // every handle is dead; nothing to delete
  };

  private readonly onRestored = (): void => {
    if (this.disposed) return;
    this.lost = false;
    this.init();
  };

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (w === this.width && h === this.height && this.canvas.width === w && this.canvas.height === h) return;
    this.width = w;
    this.height = h;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.active) this.allocLevels();
  }

  private allocLevels(): void {
    const res = this.res;
    if (!res) return;
    const gl = this.gl;
    let w = Math.max(1, Math.ceil(this.width / 2));
    let h = Math.max(1, Math.ceil(this.height / 2));
    for (const t of res.levels) {
      allocTarget(gl, t, w, h, res.hdr);
      w = Math.max(1, Math.ceil(w / 2));
      h = Math.max(1, Math.ceil(h / 2));
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /** Uploads the scene canvas; reallocates only when its size changes. */
  private upload(source: HTMLCanvasElement): boolean {
    const gl = this.gl;
    const res = this.res!;
    const sw = source.width, sh = source.height;
    if (sw === 0 || sh === 0) return false;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.scene);
    if (sw !== this.srcW || sh !== this.srcH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
      this.srcW = sw;
      this.srcH = sh;
    } else {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    }
    return true;
  }

  private drawTo(t: Target | null): void {
    const gl = this.gl;
    if (t) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo);
      gl.viewport(0, 0, t.w, t.h);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.width, this.height);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  render(source: HTMLCanvasElement, frame: PostFxFrame): void {
    if (!this.active || this.gl.isContextLost()) return;
    const gl = this.gl;
    const res = this.res!;
    if (!this.upload(source)) return;

    gl.bindVertexArray(res.vao);
    gl.disable(gl.BLEND);
    const grade = frame.grade;
    const bloomAmt = Math.max(0, grade.bloom * frame.bloomScale);
    const levels = LEVELS[frame.quality] ?? 3;
    const L = res.levels;

    if (bloomAmt > 0.001) {
      // Bright pass: full-res scene -> half-res level 0.
      gl.useProgram(res.bright.program);
      const thr = Math.min(Math.max(grade.bloomThreshold, 0), 1.5);
      gl.uniform2f(res.bright.u.uTexel, 1 / this.srcW, 1 / this.srcH);
      gl.uniform1f(res.bright.u.uThreshold, thr);
      gl.uniform1f(res.bright.u.uKnee, Math.max(0.05, thr * 0.5));
      this.drawTo(L[0]);

      // Downsample pyramid.
      gl.useProgram(res.down.program);
      for (let i = 1; i <= levels; i++) {
        const src = L[i - 1];
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(res.down.u.uTexel, 1 / src.w, 1 / src.h);
        this.drawTo(L[i]);
      }

      // Upsample, accumulating additively into each larger level.
      gl.useProgram(res.up.program);
      gl.enable(gl.BLEND);
      gl.uniform1f(res.up.u.uWeight, 1);
      for (let i = levels; i >= 1; i--) {
        const src = L[i];
        gl.bindTexture(gl.TEXTURE_2D, src.tex);
        gl.uniform2f(res.up.u.uTexel, 0.75 / src.w, 0.75 / src.h);
        this.drawTo(L[i - 1]);
      }
      gl.disable(gl.BLEND);
    }

    this.composite(frame, bloomAmt, levels);
    gl.bindVertexArray(null);
  }

  private composite(frame: PostFxFrame, bloomAmt: number, levels: number): void {
    const gl = this.gl;
    const res = this.res!;
    const c = res.composite;
    const u = c.u;
    const grade = frame.grade;
    gl.useProgram(c.program);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, res.levels[0].tex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, res.scene);

    const waves = frame.shockwaves;
    const n = Math.min(waves.length, MAX_SHOCKWAVES);
    const sh = this.shock, ss = this.shockStr;
    for (let i = 0; i < n; i++) {
      const s = waves[i];
      sh[i * 4] = s.x;
      sh[i * 4 + 1] = s.y;
      sh[i * 4 + 2] = s.radius;
      sh[i * 4 + 3] = s.width;
      ss[i] = clampN(s.strength, 0, 1.5);
    }
    gl.uniform4fv(u.uShock, sh);
    gl.uniform1fv(u.uShockStr, ss);
    gl.uniform1i(u.uShockCount, n);

    const bl = res.levels[0];
    gl.uniform2f(u.uBloomTexel, 1 / bl.w, 1 / bl.h);
    gl.uniform2f(u.uSize, this.width, this.height);
    gl.uniform1f(u.uAspect, this.width / this.height);
    gl.uniform1f(u.uChroma, clampN(frame.chroma, 0, 1.5));
    // The pyramid accumulates every level; normalise so strength is similar across tiers.
    gl.uniform1f(u.uBloomAmt, bloomAmt > 0.001 ? bloomAmt * BLOOM_NORM / (levels + 1) : 0);
    const lift = grade.lift, gam = grade.gamma, gain = grade.gain;
    gl.uniform3f(u.uLift, lift[0], lift[1], lift[2]);
    gl.uniform3f(u.uInvGamma, 1 / Math.max(gam[0], 0.05), 1 / Math.max(gam[1], 0.05), 1 / Math.max(gam[2], 0.05));
    gl.uniform3f(u.uGain, gain[0], gain[1], gain[2]);
    gl.uniform1f(u.uSaturation, grade.saturation);
    gl.uniform1f(u.uContrast, grade.contrast);
    const f = frame.flash;
    gl.uniform4f(u.uFlash, f.r, f.g, f.b, clampN(f.amount, 0, 1));
    gl.uniform1f(u.uVignette, clampN(grade.vignette, 0, 1));
    gl.uniform1f(u.uGrain, clampN(frame.grain, 0, 1));
    // Wrapped so the grain hash keeps float precision over long sessions.
    gl.uniform1f(u.uTime, frame.time % 1000);
    this.drawTo(null);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored, false);
    const res = this.res;
    this.res = null;
    const gl = this.gl;
    if (res && !gl.isContextLost()) {
      gl.deleteProgram(res.bright.program);
      gl.deleteProgram(res.down.program);
      gl.deleteProgram(res.up.program);
      gl.deleteProgram(res.composite.program);
      for (const t of res.levels) {
        gl.deleteFramebuffer(t.fbo);
        gl.deleteTexture(t.tex);
      }
      gl.deleteTexture(res.scene);
      gl.deleteBuffer(res.vbo);
      gl.deleteVertexArray(res.vao);
    }
    // Release the context now rather than at GC time (browsers cap live contexts).
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

/** Overall bloom gain applied to the normalised pyramid sum. */
const BLOOM_NORM = 1.1;

const clampN = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** Creates the post-processing pipeline, or null when WebGL2 (or a required feature) is unavailable. */
export function createPostFx(): PostFxApi | null {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) return null;
    const fx = new PostFx(canvas, gl);
    if (!fx.init()) {
      fx.dispose();
      return null;
    }
    return fx;
  } catch (err) {
    console.warn('[postfx] unavailable:', err);
    return null;
  }
}

