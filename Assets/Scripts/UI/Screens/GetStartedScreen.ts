import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import animate, {CancelSet} from "SpectaclesInteractionKit.lspkg/Utils/animate"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {EventBus} from "../../Shared/EventBus"
import {addButtonLabel} from "../../Shared/ButtonTextHelper"
import {AppScreen} from "../UIController"

interface IntroNode {
  obj: SceneObject
  finalPos: vec3
  finalScale: vec3
  delay: number
}

const TITLE_TEXT = "Circuit"
const SUBTITLE_TEXT = "Follow layered paths through real places."
const BODY_TEXT =
  "Mark stops, connect them into a walk, and let each person add a layer of context."
const OPENING_START_DELAY_SECONDS = 1.05
const OPENING_TOTAL_DURATION = 3.1
const OPENING_PHASE_2_START = 0.1
const OPENING_PHASE_3_START = 0.37
const OPENING_EXIT_START = 0.8
const OPENING_LIFT_DISTANCE = 2.65
const OPENING_LOGO_FINAL_POS = new vec3(0, 2.15, 0.45)
const OPENING_TITLE_FINAL_POS = new vec3(0, -2.15, 0.48)
const OPENING_LOGO_SIZE = 5.7
const OPENING_TITLE_COLOR = new vec4(1, 1, 1, 1)

/**
 * Screen 1: Circuit intro.
 * WaypointV2-inspired staged title screen with a compact route preview.
 */
export class GetStartedScreen {
  private container: SceneObject
  private contentObj: SceneObject
  private splashObj: SceneObject
  private splashLogoObj: SceneObject | null = null
  private splashTitleObj: SceneObject | null = null
  private splashLogoImage: Image | null = null
  private splashTitleText: Text | null = null
  private logger: Logger
  private eventBus: EventBus
  private boldFont: Font | null = null
  private circuitLogoTexture: Texture | null = null
  private circuitLogoMaterial: Material | null = null
  private introNodes: IntroNode[] = []
  private introCancelSet: CancelSet = new CancelSet()
  private openingDelayObj: SceneObject | null = null
  private openingRunId: number = 0
  private openingPlayed: boolean = false

  constructor(parent: SceneObject, eventBus: EventBus, logger: Logger) {
    this.logger = logger
    this.eventBus = eventBus

    this.container = global.scene.createSceneObject("GetStartedScreen")
    this.container.setParent(parent)

    this.buildContent()

    this.logger.debug("GetStartedScreen built")
  }

  show(): void {
    this.container.enabled = true
    if (this.openingPlayed) {
      this.splashObj.enabled = false
      this.contentObj.enabled = true
      this.playIntro()
      return
    }

    this.playOpeningIntro()
  }

  hide(): void {
    this.introCancelSet.cancel()
    this.cancelOpeningDelay()
    this.splashObj.enabled = false
    this.contentObj.enabled = true
    this.container.enabled = false
  }

  destroy(): void {
    this.introCancelSet.cancel()
    this.cancelOpeningDelay()
    this.container.destroy()
  }

  getContainer(): SceneObject {
    return this.container
  }

  // ── Internal ───────────────────────────────────────────

  private buildContent(): void {
    this.contentObj = global.scene.createSceneObject("GetStartedContent")
    this.contentObj.setParent(this.container)
    this.contentObj.getTransform().setLocalPosition(new vec3(0, 0, 2))

    this.buildOpeningSplash()

    this.createText(
      "CircuitTitle",
      TITLE_TEXT,
      new vec3(0, 4.55, 0.1),
      new vec2(20, 2.5),
      72,
      new vec4(1, 1, 1, 1),
      0,
      true
    )

    this.createText(
      "CircuitSubtitle",
      SUBTITLE_TEXT,
      new vec3(0, 2.55, 0.1),
      new vec2(24, 1.6),
      28,
      new vec4(0.72, 0.95, 1, 0.96),
      0.1
    )

    this.buildRoutePreview()

    this.createText(
      "CircuitIntroBody",
      BODY_TEXT,
      new vec3(0, -2.65, 0.1),
      new vec2(22, 2),
      22,
      new vec4(1, 1, 1, 0.92),
      0.32
    )

    this.createActionButton(
      "StartCircuitButton",
      "Start Circuit",
      new vec3(-5.25, -5.35, 0.1),
      new vec2(10.2, 3.35),
      AppScreen.Capture,
      0.46
    )
    this.createActionButton(
      "OpenAreasButton",
      "My Areas",
      new vec3(5.25, -5.35, 0.1),
      new vec2(8.8, 3.35),
      AppScreen.MyAreas,
      0.52
    )
  }

  private buildOpeningSplash(): void {
    this.splashObj = global.scene.createSceneObject("CircuitOpeningSplash")
    this.splashObj.setParent(this.container)
    this.splashObj.getTransform().setLocalPosition(new vec3(0, 0, 3.2))
    this.splashObj.enabled = false

    this.splashLogoObj = global.scene.createSceneObject("CircuitOpeningLogo")
    this.splashLogoObj.setParent(this.splashObj)
    this.splashLogoObj.getTransform().setLocalPosition(OPENING_LOGO_FINAL_POS)
    this.splashLogoObj
      .getTransform()
      .setLocalScale(new vec3(OPENING_LOGO_SIZE, OPENING_LOGO_SIZE, 1))

    this.splashLogoImage = this.splashLogoObj.createComponent("Component.Image") as Image
    this.splashLogoImage.renderOrder = 25
    const sourceImage = this.findLogoImageInScene()
    if (sourceImage && sourceImage.mainMaterial) {
      this.splashLogoImage.mainMaterial = sourceImage.mainMaterial.clone()
    } else {
      const material = this.getCircuitLogoMaterial()
      if (material) {
        this.splashLogoImage.mainMaterial = material.clone()
      }
    }

    const logoTexture = this.getCircuitLogoTexture()
    if (logoTexture && this.splashLogoImage.mainPass) {
      this.splashLogoImage.mainPass.baseTex = logoTexture
    }

    this.splashTitleText = this.createOpeningText(
      "CircuitOpeningTitle",
      TITLE_TEXT,
      OPENING_TITLE_FINAL_POS,
      new vec2(20, 2.7),
      76,
      OPENING_TITLE_COLOR,
      true
    )
    this.splashTitleObj = this.splashTitleText.getSceneObject()
    this.setOpeningAlpha(0)
  }

  private buildRoutePreview(): void {
    const nodes = [
      {label: "01", caption: "Mark", x: -7.2},
      {label: "02", caption: "Layer", x: -2.35},
      {label: "03", caption: "Follow", x: 2.65},
      {label: "+", caption: "Add", x: 7.2},
    ]

    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      this.createText(
        `PreviewNode${i}`,
        `${node.label}\n${node.caption}`,
          new vec3(node.x, -0.05, 0.1),
          new vec2(4.1, 2.7),
        node.label === "+" ? 30 : 27,
        i === 0
          ? new vec4(1, 0.9, 0.25, 1)
          : new vec4(1, 1, 1, 0.95),
        0.18 + i * 0.06
      )

      if (i < nodes.length - 1) {
        this.createText(
          `PreviewWire${i}`,
          "-->",
          new vec3((node.x + nodes[i + 1].x) * 0.5, 0.08, 0.1),
          new vec2(3.4, 1),
          21,
          new vec4(0.45, 0.95, 0.95, 0.78),
          0.22 + i * 0.06
        )
      }
    }
  }

  private createActionButton(
    name: string,
    label: string,
    position: vec3,
    size: vec2,
    targetScreen: AppScreen,
    delay: number
  ): void {
    const btnObj = global.scene.createSceneObject(name)
    btnObj.setParent(this.contentObj)
    btnObj.getTransform().setLocalPosition(position)

    const btn = btnObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
    ;(btn as any)._style = targetScreen === AppScreen.Capture ? "Primary" : "PrimaryNeutral"
    btn.size = new vec3(size.x, size.y, 1)
    btn.renderOrder = 10
    btn.initialize()
    addButtonLabel(btnObj, label, size.x, size.y, 25)
    btn.onTriggerUp.add(() => {
      if (name === "StartCircuitButton") {
        this.eventBus.emit("startCircuit")
        return
      }
      this.eventBus.emit("navigate", targetScreen)
    })

    this.registerIntroNode(btnObj, delay)
  }

  private createText(
    name: string,
    text: string,
    position: vec3,
    rectSize: vec2,
    size: number,
    color: vec4,
    delay: number,
    useBoldFont: boolean = false
  ): Text {
    const textObj = global.scene.createSceneObject(name)
    textObj.setParent(this.contentObj)
    textObj.getTransform().setLocalPosition(position)

    const textComp = textObj.createComponent("Component.Text") as Text
    textComp.text = text
    textComp.size = size
    textComp.worldSpaceRect = Rect.create(
      -rectSize.x * 0.5,
      rectSize.x * 0.5,
      -rectSize.y * 0.5,
      rectSize.y * 0.5
    )
    textComp.horizontalOverflow = HorizontalOverflow.Wrap
    textComp.verticalOverflow = VerticalOverflow.Shrink
    textComp.horizontalAlignment = HorizontalAlignment.Center
    textComp.verticalAlignment = VerticalAlignment.Center
    textComp.textFill.mode = TextFillMode.Solid
    textComp.textFill.color = color
    textComp.renderOrder = 10
    if (useBoldFont) {
      const bold = this.getBoldFont()
      if (bold) {
        textComp.font = bold
      }
    }

    this.registerIntroNode(textObj, delay)
    return textComp
  }

  private getBoldFont(): Font | null {
    if (this.boldFont) return this.boldFont
    try {
      this.boldFont = requireAsset("Fonts/theboldfont.ttf") as Font
      return this.boldFont
    } catch (_e) {
      return null
    }
  }

  private registerIntroNode(obj: SceneObject, delay: number): void {
    const transform = obj.getTransform()
    this.introNodes.push({
      obj,
      finalPos: transform.getLocalPosition(),
      finalScale: transform.getLocalScale(),
      delay,
    })
  }

  private playIntro(): void {
    this.introCancelSet.cancel()
    this.introCancelSet = new CancelSet()

    for (const node of this.introNodes) {
      node.obj.getTransform().setLocalPosition(
        node.finalPos.add(new vec3(0, -1.25, 0))
      )
      node.obj.getTransform().setLocalScale(this.scaleVec(node.finalScale, 0.82))
    }

    animate({
      duration: 1.05,
      cancelSet: this.introCancelSet,
      easing: "ease-out-cubic",
      update: (t: number) => {
        for (const node of this.introNodes) {
          const localT = this.clamp((t - node.delay) / 0.42, 0, 1)
          const eased = 1 - Math.pow(1 - localT, 3)
          const startPos = node.finalPos.add(new vec3(0, -1.25, 0))
          node.obj.getTransform().setLocalPosition(this.lerpVec(startPos, node.finalPos, eased))
          node.obj.getTransform().setLocalScale(
            this.scaleVec(node.finalScale, 0.82 + eased * 0.18)
          )
        }
      },
    })
  }

  private playOpeningIntro(): void {
    this.openingPlayed = true
    this.introCancelSet.cancel()
    this.introCancelSet = new CancelSet()
    this.cancelOpeningDelay()
    this.contentObj.enabled = false
    this.splashObj.enabled = true
    this.setOpeningAlpha(1)

    const logoLowerPos = OPENING_LOGO_FINAL_POS.add(new vec3(0, -OPENING_LIFT_DISTANCE, 0))
    const titleLowerPos = OPENING_TITLE_FINAL_POS.add(new vec3(0, -OPENING_LIFT_DISTANCE, 0))
    const logoFinalScale = new vec3(OPENING_LOGO_SIZE, OPENING_LOGO_SIZE, 1)
    const titleFinalScale = this.splashTitleObj
      ? this.splashTitleObj.getTransform().getLocalScale()
      : new vec3(1, 1, 1)

    this.splashLogoObj?.getTransform().setLocalPosition(logoLowerPos)
    this.splashLogoObj?.getTransform().setLocalScale(new vec3(0, 0, 0))
    this.splashLogoObj?.getTransform().setLocalRotation(quat.angleAxis(0, vec3.forward()))
    this.splashTitleObj?.getTransform().setLocalPosition(titleLowerPos)
    this.splashTitleObj?.getTransform().setLocalScale(new vec3(0, 0, 0))

    const runId = ++this.openingRunId
    this.openingDelayObj = global.scene.createSceneObject("CircuitOpeningDelay")
    this.openingDelayObj.setParent(this.splashObj)
    const delayScript = this.openingDelayObj.createComponent("ScriptComponent") as ScriptComponent
    const delayEvent = delayScript.createEvent("DelayedCallbackEvent") as DelayedCallbackEvent
    delayEvent.reset(OPENING_START_DELAY_SECONDS)
    delayEvent.bind(() => {
      if (
        runId !== this.openingRunId ||
        !this.container.enabled ||
        !this.splashObj.enabled
      ) {
        return
      }

      this.cancelOpeningDelay(false)
      this.runOpeningIntroAnimation(
        logoLowerPos,
        titleLowerPos,
        logoFinalScale,
        titleFinalScale
      )
    })
  }

  private runOpeningIntroAnimation(
    logoLowerPos: vec3,
    titleLowerPos: vec3,
    logoFinalScale: vec3,
    titleFinalScale: vec3
  ): void {
    let completed = false

    animate({
      duration: OPENING_TOTAL_DURATION,
      cancelSet: this.introCancelSet,
      easing: "ease-in-out-cubic",
      update: (t: number) => {
        const fadeInT = this.clamp(
          (t - OPENING_PHASE_2_START) /
            (OPENING_PHASE_3_START - OPENING_PHASE_2_START),
          0,
          1
        )
        const liftT = this.clamp(
          (t - OPENING_PHASE_3_START) /
            (OPENING_EXIT_START - OPENING_PHASE_3_START),
          0,
          1
        )
        const exitT = this.clamp(
          (t - OPENING_EXIT_START) / (1 - OPENING_EXIT_START),
          0,
          1
        )
        const fadeEase = 1 - Math.pow(1 - fadeInT, 2)
        const fadeAlpha = fadeEase * (1 - exitT)
        const visibilityScale = fadeEase
        const liftEase = 1 - Math.pow(1 - liftT, 3)
        const exitEase = exitT * exitT

        const logoPos = this.lerpVec(logoLowerPos, OPENING_LOGO_FINAL_POS, liftEase)
          .add(new vec3(0, exitEase * 1.1, 0))
        const titlePos = this.lerpVec(titleLowerPos, OPENING_TITLE_FINAL_POS, liftEase)
          .add(new vec3(0, exitEase * 1.1, 0))
        const logoScale = 0.88 + liftEase * 0.12 + exitEase * 0.08
        const titleScale = 0.92 + liftEase * 0.08 + exitEase * 0.04
        const spinAngle = Math.PI * 2 * liftEase

        this.splashLogoObj?.getTransform().setLocalPosition(logoPos)
        this.splashLogoObj?.getTransform().setLocalScale(
          this.scaleVec(logoFinalScale, logoScale * visibilityScale)
        )
        this.splashLogoObj?.getTransform().setLocalRotation(quat.angleAxis(spinAngle, vec3.forward()))
        this.splashTitleObj?.getTransform().setLocalPosition(titlePos)
        this.splashTitleObj?.getTransform().setLocalScale(
          this.scaleVec(titleFinalScale, titleScale * visibilityScale)
        )
        this.setOpeningAlpha(fadeAlpha)

        if (t >= 0.999 && !completed) {
          completed = true
          this.finishOpeningIntro()
        }
      },
    })
  }

  private cancelOpeningDelay(invalidateRun: boolean = true): void {
    if (invalidateRun) {
      this.openingRunId++
    }
    if (!this.openingDelayObj) return
    this.openingDelayObj.destroy()
    this.openingDelayObj = null
  }

  private finishOpeningIntro(): void {
    this.splashObj.enabled = false
    this.contentObj.enabled = true
    this.playIntro()
  }

  private createOpeningText(
    name: string,
    text: string,
    position: vec3,
    rectSize: vec2,
    size: number,
    color: vec4,
    useBoldFont: boolean
  ): Text {
    const textObj = global.scene.createSceneObject(name)
    textObj.setParent(this.splashObj)
    textObj.getTransform().setLocalPosition(position)

    const textComp = textObj.createComponent("Component.Text") as Text
    textComp.text = text
    textComp.size = size
    textComp.worldSpaceRect = Rect.create(
      -rectSize.x * 0.5,
      rectSize.x * 0.5,
      -rectSize.y * 0.5,
      rectSize.y * 0.5
    )
    textComp.horizontalOverflow = HorizontalOverflow.Wrap
    textComp.verticalOverflow = VerticalOverflow.Shrink
    textComp.horizontalAlignment = HorizontalAlignment.Center
    textComp.verticalAlignment = VerticalAlignment.Center
    textComp.textFill.mode = TextFillMode.Solid
    textComp.textFill.color = color
    textComp.renderOrder = 26
    if (useBoldFont) {
      const bold = this.getBoldFont()
      if (bold) {
        textComp.font = bold
      }
    }
    return textComp
  }

  private setOpeningAlpha(alpha: number): void {
    const safeAlpha = this.clamp(alpha, 0, 1)
    if (this.splashTitleText) {
      this.splashTitleText.textFill.color = new vec4(
        OPENING_TITLE_COLOR.x,
        OPENING_TITLE_COLOR.y,
        OPENING_TITLE_COLOR.z,
        safeAlpha
      )
    }
    if (this.splashLogoImage?.mainPass) {
      this.splashLogoImage.mainPass.baseColor = new vec4(1, 1, 1, safeAlpha)
    }
  }

  private getCircuitLogoTexture(): Texture | null {
    if (this.circuitLogoTexture) return this.circuitLogoTexture
    const candidates = [
      "Circuit Logo.png",
      "Assets/Circuit Logo.png",
      "../Circuit Logo.png",
      "../../Circuit Logo.png",
      "../../../Circuit Logo.png",
    ]
    for (let i = 0; i < candidates.length; i++) {
      try {
        this.circuitLogoTexture = requireAsset(candidates[i]) as Texture
        if (this.circuitLogoTexture) return this.circuitLogoTexture
      } catch (_e) {
        // Try the next Lens Studio asset path.
      }
    }

    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const root = global.scene.getRootObject(i)
      const texture = this.findLogoTextureRecursive(root)
      if (texture) {
        this.circuitLogoTexture = texture
        return this.circuitLogoTexture
      }
    }
    return null
  }

  private getCircuitLogoMaterial(): Material | null {
    if (this.circuitLogoMaterial) return this.circuitLogoMaterial
    const candidates = [
      "ImageMaterial.mat",
      "Assets/ImageMaterial.mat",
      "Materials/Image.mat",
      "Assets/Materials/Image.mat",
    ]
    for (let i = 0; i < candidates.length; i++) {
      try {
        this.circuitLogoMaterial = requireAsset(candidates[i]) as Material
        if (this.circuitLogoMaterial) return this.circuitLogoMaterial
      } catch (_e) {
        // Try the next Lens Studio asset path.
      }
    }
    return null
  }

  private findLogoTextureRecursive(obj: SceneObject): Texture | null {
    if (obj.name.toLowerCase().indexOf("circuit logo") !== -1) {
      const image = obj.getComponent("Component.Image") as Image
      if (image && image.mainPass && image.mainPass.baseTex) {
        return image.mainPass.baseTex as Texture
      }
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      const found = this.findLogoTextureRecursive(obj.getChild(i))
      if (found) return found
    }
    return null
  }

  private findLogoImageInScene(): Image | null {
    for (let i = 0; i < global.scene.getRootObjectsCount(); i++) {
      const root = global.scene.getRootObject(i)
      const found = this.findLogoImageRecursive(root)
      if (found) return found
    }
    return null
  }

  private findLogoImageRecursive(obj: SceneObject): Image | null {
    if (obj.name.toLowerCase().indexOf("circuit logo") !== -1) {
      const image = obj.getComponent("Component.Image") as Image
      if (image) return image
    }
    for (let i = 0; i < obj.getChildrenCount(); i++) {
      const found = this.findLogoImageRecursive(obj.getChild(i))
      if (found) return found
    }
    return null
  }

  private lerpVec(from: vec3, to: vec3, t: number): vec3 {
    return new vec3(
      from.x + (to.x - from.x) * t,
      from.y + (to.y - from.y) * t,
      from.z + (to.z - from.z) * t
    )
  }

  private scaleVec(value: vec3, scale: number): vec3 {
    return new vec3(value.x * scale, value.y * scale, value.z * scale)
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }
}
