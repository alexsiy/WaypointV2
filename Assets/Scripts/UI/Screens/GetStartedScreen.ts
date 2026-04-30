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

/**
 * Screen 1: Circuit intro.
 * WaypointV2-inspired staged title screen with a compact route preview.
 */
export class GetStartedScreen {
  private container: SceneObject
  private contentObj: SceneObject
  private logger: Logger
  private eventBus: EventBus
  private introNodes: IntroNode[] = []
  private introCancelSet: CancelSet = new CancelSet()

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
    this.playIntro()
  }

  hide(): void {
    this.introCancelSet.cancel()
    this.container.enabled = false
  }

  destroy(): void {
    this.introCancelSet.cancel()
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

    this.createText(
      "CircuitTitle",
      TITLE_TEXT,
      new vec3(0, 4.55, 0.1),
      new vec2(20, 2.5),
      72,
      new vec4(1, 1, 1, 1),
      0
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
    delay: number
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

    this.registerIntroNode(textObj, delay)
    return textComp
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
