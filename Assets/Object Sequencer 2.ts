/*
 * ObjectSequencer.ts
 *
 * Sequence:
 *   Phase 1 — (nothing visible)
 *   Phase 2 — Icon AND Title both fade in at their lower positions
 *   Phase 3 — Icon AND Title lift together to their final positions
 *             Start Button appears
 *
 * SETUP: Place all objects at their FINAL positions in the editor, leave enabled.
 */

@component
export class ObjectSequencer extends BaseScriptComponent {

  // ── Object slots ─────────────────────────────────────────────────────────────
  @input icon: SceneObject;
  @input title: SceneObject;
  @input startBtn: SceneObject;

  // ── Timing (seconds) ─────────────────────────────────────────────────────────
  @input startAutomatically: boolean = true;

  @input phase1Delay: number = 0;
  @input phase2Delay: number = 0.8;
  @input phase3Delay: number = 0.5;

  // ── Distances ────────────────────────────────────────────────────────────────
  @input liftDistance: number = 12;

  // ── Animation durations (seconds) ────────────────────────────────────────────
  @input liftDuration: number = 0.5;
  @input fadeTextDuration: number = 0.4;

  // ── Internal ─────────────────────────────────────────────────────────────────
  private iconFinalPos: vec3     = new vec3(0,0,0);
  private iconPhase2Pos: vec3    = new vec3(0,0,0);
  private titleFinalPos: vec3    = new vec3(0,0,0);
  private titlePhase2Pos: vec3   = new vec3(0,0,0);
  private originalScales: Map<SceneObject, vec3> = new Map();
  private textComponents: Map<SceneObject, any>  = new Map();
  private textOrigColors: Map<SceneObject, vec4> = new Map();
  private isPlaying: boolean = false;

  onAwake() {
    this.init();
    const startEvent = this.createEvent('OnStartEvent');
    startEvent.bind(() => {
      if (this.startAutomatically) this.play();
    });
  }

  private init() {
    const all = [this.icon, this.title, this.startBtn];

    for (let i = 0; i < all.length; i++) {
      if (all[i]) {
        this.captureScalesRecursive(all[i]);
        this.captureTextComponentsRecursive(all[i]);
      }
    }

    if (this.icon) {
      const p = this.icon.getTransform().getLocalPosition();
      this.iconFinalPos  = new vec3(p.x, p.y, p.z);
      this.iconPhase2Pos = new vec3(p.x, p.y - this.liftDistance, p.z);
    }
    if (this.title) {
      const p = this.title.getTransform().getLocalPosition();
      this.titleFinalPos  = new vec3(p.x, p.y, p.z);
      this.titlePhase2Pos = new vec3(p.x, p.y - this.liftDistance, p.z);
    }

    for (let i = 0; i < all.length; i++) {
      if (all[i]) this.hideRecursive(all[i]);
    }

    if (this.icon) {
      this.icon.getTransform().setLocalPosition(this.iconPhase2Pos);
    }
    if (this.title) this.title.getTransform().setLocalPosition(this.titlePhase2Pos);
  }

  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;

    const p1 = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent;
    p1.reset(this.phase1Delay);
    p1.bind(() => {
      if (!this.isPlaying) return;

      // ── Phase 1: nothing visible ──────────────────────────────────────────

      const p2 = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent;
      p2.reset(this.phase2Delay);
      p2.bind(() => {
        if (!this.isPlaying) return;

        // ── Phase 2: Icon and Title both fade in at their lower positions ──
        if (this.icon) {
          this.showRecursive(this.icon);
          this.fadeInTextRecursive(this.icon);
        }
        if (this.title) {
          this.showRecursive(this.title);
          this.fadeInTextRecursive(this.title);
        }

        const p3 = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent;
        p3.reset(this.phase3Delay);
        p3.bind(() => {
          if (!this.isPlaying) return;

          // ── Phase 3: Icon + Title lift together, then show start button
          if (this.icon) {
            this.animateLift(this.icon, this.iconPhase2Pos, this.iconFinalPos, this.liftDuration);
          }
          if (this.title) {
            this.animateLift(this.title, this.titlePhase2Pos, this.titleFinalPos, this.liftDuration);
          }

          this.delayedShow(this.startBtn, 0);

          this.isPlaying = false;
        });
      });
    });
  }

  stop() {
    this.isPlaying = false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  private delayedShow(obj: SceneObject, delay: number) {
    if (!obj) return;
    if (delay <= 0) {
      this.showRecursive(obj);
      this.fadeInTextRecursive(obj);
      return;
    }
    const evt = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent;
    evt.reset(delay);
    evt.bind(() => {
      this.showRecursive(obj);
      this.fadeInTextRecursive(obj);
    });
  }

  private showRecursive(obj: SceneObject) {
    if (!obj) return;
    const t = obj.getTransform();
    if (t) {
      const orig = this.originalScales.get(obj);
      t.setLocalScale(orig ? new vec3(orig.x, orig.y, orig.z) : new vec3(1, 1, 1));
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.showRecursive(obj.getChild(i));
    }
  }

  private hideRecursive(obj: SceneObject) {
    if (!obj) return;
    const t = obj.getTransform();
    if (t) t.setLocalScale(new vec3(0, 0, 0));
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.hideRecursive(obj.getChild(i));
    }
  }

  private fadeInTextRecursive(obj: SceneObject) {
    if (!obj) return;
    const c = this.textComponents.get(obj);
    if (c) {
      const stored = this.textOrigColors.get(obj);
      const r = stored ? stored.x : 1;
      const g = stored ? stored.y : 1;
      const b = stored ? stored.z : 1;
      c.textFill.color = new vec4(r, g, b, 0);
      this.animateOverTime(this.fadeTextDuration, (t) => {
        const a = 1 - Math.pow(1 - t, 2);
        c.textFill.color = new vec4(r, g, b, a);
      });
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.fadeInTextRecursive(obj.getChild(i));
    }
  }

  private animateLift(obj: SceneObject, from: vec3, to: vec3, duration: number) {
    this.animateOverTime(duration, (t) => {
      const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
      obj.getTransform().setLocalPosition(new vec3(
        from.x + (to.x - from.x) * e,
        from.y + (to.y - from.y) * e,
        from.z + (to.z - from.z) * e
      ));
    }, () => {
      obj.getTransform().setLocalPosition(to);
    });
  }

  private animateOverTime(duration: number, updateFn: (t: number) => void, onComplete?: () => void) {
    if (duration <= 0) {
      updateFn(1);
      if (onComplete) onComplete();
      return;
    }
    let elapsed = 0;
    const evt = this.createEvent('UpdateEvent');
    evt.bind(() => {
      elapsed += getDeltaTime();
      const t = Math.min(1, elapsed / duration);
      updateFn(t);
      if (t >= 1) { (evt as any).enabled = false; if (onComplete) onComplete(); }
    });
  }

  private captureScalesRecursive(obj: SceneObject) {
    if (!obj) return;
    const t = obj.getTransform();
    if (t) {
      const s = t.getLocalScale();
      this.originalScales.set(obj, new vec3(s.x, s.y, s.z));
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.captureScalesRecursive(obj.getChild(i));
    }
  }

  private captureTextComponentsRecursive(obj: SceneObject) {
    if (!obj) return;
    const types = ['Component.Text', 'Component.Label', 'Component.ScreenText', 'Component.WorldText'];
    for (let i = 0; i < types.length; i++) {
      const c = obj.getComponent(types[i] as any) as any;
      if (c && c.textFill) {
        this.textComponents.set(obj, c);
        const col = c.textFill.color;
        this.textOrigColors.set(obj, new vec4(col.x, col.y, col.z, col.w));
        break;
      }
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.captureTextComponentsRecursive(obj.getChild(i));
    }
  }
}
