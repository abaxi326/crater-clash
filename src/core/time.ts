/** Hit-stop and slow motion. The main loop converts real frame time into simulation time here. */
import { clamp, smoothstep } from './math.ts';

export class TimeControl {
  private stopLeft = 0;
  private slowLeft = 0;
  private slowTotal = 0;
  private slowScale = 1;
  private current = 1;

  /** Freeze simulation time briefly (impact punch). */
  hitStop(seconds: number): void {
    this.stopLeft = Math.max(this.stopLeft, clamp(seconds, 0, 0.25));
  }

  /** Run the simulation at `scale` for `seconds` of real time, easing back to normal at the end. */
  slowMo(scale: number, seconds: number): void {
    this.slowScale = clamp(scale, 0.05, 1);
    this.slowTotal = this.slowLeft = Math.max(this.slowLeft, seconds);
  }

  /** Converts real elapsed seconds into simulation seconds. */
  step(realDt: number): number {
    if (this.stopLeft > 0) {
      this.stopLeft -= realDt;
      this.current = 0;
      return 0;
    }
    if (this.slowLeft > 0) {
      this.slowLeft = Math.max(0, this.slowLeft - realDt);
      // Hold the slow scale, then ease back to 1 over the final 35% of the effect.
      const recover = 1 - smoothstep(0, this.slowTotal * 0.35, this.slowLeft);
      this.current = this.slowScale + (1 - this.slowScale) * recover;
    } else {
      this.current = 1;
    }
    return realDt * this.current;
  }

  /** Current time scale (0 during hit-stop). */
  get scale(): number {
    return this.current;
  }

  reset(): void {
    this.stopLeft = this.slowLeft = this.slowTotal = 0;
    this.slowScale = this.current = 1;
  }
}
