/*
 * ObjectSequencer.ts
 * Sequences SceneObjects appearing and disappearing with timers.
 * — preserves each object's original scale instead of forcing vec3(1,1,1)
 * — fades objects in when showing them
 */

@component
export class ObjectSequencer extends BaseScriptComponent {

  @input
  startAutomatically: boolean = true;

  @input
  loopCount: number = 1;

  @input
  objects: SceneObject[] = [];

  // type exactly "show" or "hide" in editor for each object
  @input
  actions: string[] = [];

  @input
  delays: number[] = [];

  // how long (in seconds) the fade-in takes when showing an object
  @input
  fadeDuration: number = 0.5;

  private originalScales: Map<SceneObject, vec3> = new Map();
  // original alpha per material pass, captured at start
  private originalAlphas: Map<Pass, number> = new Map();
  private scalesCaptured: boolean = false;

  private currentLoop: number = 0;
  private isPlaying: boolean = false;

  private activeFades: Array<{
    passes: Pass[];
    elapsed: number;
    duration: number;
  }> = [];

  onAwake() {
    const startEvent = this.createEvent('OnStartEvent');
    startEvent.bind(() => {
      if (!this.scalesCaptured) {
        this.captureOriginalData();
      }
      if (this.startAutomatically) {
        this.play();
      }
    });

    const updateEvent = this.createEvent('UpdateEvent');
    updateEvent.bind(() => {
      this.tickFades(getDeltaTime());
    });
  }

  // Capture scales AND original material alphas so we can restore them
  private captureOriginalData() {
    if (this.scalesCaptured) return;
    for (let i = 0; i < this.objects.length; i++) {
      const obj = this.objects[i];
      if (obj) this.captureRecursive(obj);
    }
    this.scalesCaptured = true;
  }

  private captureRecursive(obj: SceneObject) {
    if (!obj) return;

    // store scale
    const t = obj.getTransform();
    if (t) {
      const s = t.getLocalScale();
      this.originalScales.set(obj, new vec3(s.x, s.y, s.z));
    }

    // store alpha for each material pass on this object
    const visual = obj.getComponent('Component.MeshVisual') as MaterialMeshVisual;
    if (visual) {
      const pass = visual.mainPass;
      if (pass) {
        this.originalAlphas.set(pass, pass.baseColor.a);
      }
    }

    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.captureRecursive(obj.getChild(i));
    }
  }

  play() {
    if (!this.scalesCaptured) this.captureOriginalData();
    this.currentLoop = 0;
    this.isPlaying = true;
    this.scheduleStep(0);
  }

  stop() {
    this.isPlaying = false;
  }

  private scheduleStep(index: number) {
    if (!this.isPlaying) return;

    if (index >= this.objects.length) {
      this.currentLoop++;
      const shouldLoop = this.loopCount === 0 || this.currentLoop < this.loopCount;
      if (shouldLoop) {
        this.scheduleStep(0);
      } else {
        print('[ObjectSequencer] Sequence complete.');
        this.isPlaying = false;
      }
      return;
    }

    const obj = this.objects[index];
    const action = this.actions[index] ?? 'show';
    const delay = Math.max(0, this.delays[index] ?? 0);

    const handle = this.createEvent('DelayedCallbackEvent') as DelayedCallbackEvent;
    handle.reset(delay);
    handle.bind(() => {
      if (!obj) {
        print(`[ObjectSequencer] Step ${index}: No object assigned — skipping.`);
      } else {
        const showing = action === 'show';
        if (showing) {
          this.showWithFade(obj);
          print(`[ObjectSequencer] Step ${index}: Fading in "${obj.name}"`);
        } else {
          this.hideInstant(obj);
          print(`[ObjectSequencer] Step ${index}: Hid "${obj.name}"`);
        }
      }
      this.scheduleStep(index + 1);
    });
  }

  // ─── Show: enable → set alpha 0 → restore scale → start fade ───────────────

  private showWithFade(obj: SceneObject) {
    // 1. collect passes BEFORE enabling so we can zero them first
    const passes: Pass[] = [];
    this.collectPassesRecursive(obj, passes);

    // 2. set alpha to 0 on all passes
    this.setPassesAlpha(passes, 0);

    // 3. now enable the object tree & restore scales
    this.enableRecursive(obj);

    // 4. register fade tween (skipped if fadeDuration is 0)
    if (this.fadeDuration > 0 && passes.length > 0) {
      this.activeFades.push({ passes, elapsed: 0, duration: this.fadeDuration });
    } else {
      // no fade — jump straight to original alphas
      this.restorePassesAlpha(passes);
    }
  }

  private enableRecursive(obj: SceneObject) {
    if (!obj) return;
    obj.enabled = true;
    const t = obj.getTransform();
    if (t) {
      const orig = this.originalScales.get(obj);
      t.setLocalScale(orig ? new vec3(orig.x, orig.y, orig.z) : new vec3(1, 1, 1));
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.enableRecursive(obj.getChild(i));
    }
  }

  // ─── Hide: scale to 0 + disable ─────────────────────────────────────────────

  private hideInstant(obj: SceneObject) {
    if (!obj) return;
    const t = obj.getTransform();
    if (t) t.setLocalScale(new vec3(0, 0, 0));
    obj.enabled = false;
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.hideInstant(obj.getChild(i));
    }
  }

  // ─── Fade tick ───────────────────────────────────────────────────────────────

  private tickFades(dt: number) {
    for (let i = this.activeFades.length - 1; i >= 0; i--) {
      const fade = this.activeFades[i];
      fade.elapsed += dt;
      const t = Math.min(fade.elapsed / fade.duration, 1);
      // ease-out quad
      const eased = 1 - (1 - t) * (1 - t);

      for (let j = 0; j < fade.passes.length; j++) {
        const pass = fade.passes[j];
        const targetAlpha = this.originalAlphas.get(pass) ?? 1;
        const c = pass.baseColor;
        pass.baseColor = new vec4(c.r, c.g, c.b, eased * targetAlpha);
      }

      if (t >= 1) {
        this.activeFades.splice(i, 1);
      }
    }
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private collectPassesRecursive(obj: SceneObject, out: Pass[]) {
    if (!obj) return;
    const visual = obj.getComponent('Component.MeshVisual') as MaterialMeshVisual;
    if (visual && visual.mainPass) {
      out.push(visual.mainPass);
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      this.collectPassesRecursive(obj.getChild(i), out);
    }
  }

  private setPassesAlpha(passes: Pass[], alpha: number) {
    for (let i = 0; i < passes.length; i++) {
      const c = passes[i].baseColor;
      passes[i].baseColor = new vec4(c.r, c.g, c.b, alpha);
    }
  }

  private restorePassesAlpha(passes: Pass[]) {
    for (let i = 0; i < passes.length; i++) {
      const pass = passes[i];
      const orig = this.originalAlphas.get(pass) ?? 1;
      const c = pass.baseColor;
      pass.baseColor = new vec4(c.r, c.g, c.b, orig);
    }
  }
}