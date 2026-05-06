import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {GridLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/GridLayout/GridLayout"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {EventBus} from "../../Shared/EventBus"
import {addButtonLabel} from "../../Shared/ButtonTextHelper"
import {DEFAULT_CIRCUITS} from "../../Circuits/CircuitTypes"

const INSTRUCTION_TEXT =
  "Build the walk, then add story context to each stop."
const FOLLOW_INSTRUCTION_TEXT =
  "Walk the route one stop at a time. Story panels reveal as you go."

const WIDGET_TYPE_MAP: Record<string, string> = {
  "Note +": "note",
}

interface ButtonConfig {
  label: string
  event: string
  style?: "Primary" | "PrimaryNeutral"
  fontSize?: number
  payload?: unknown
  requiresAreaReady?: boolean
  requiresFollowActive?: boolean
  disabledWhenFollowing?: boolean
}

interface LayerButtonRef {
  name: string
  btn: RectangleButton
  text: Text
}

interface ManagedButtonRef {
  label: string
  btn: RectangleButton
  text: Text
  requiresAreaReady: boolean
  requiresFollowActive: boolean
  disabledWhenFollowing: boolean
}

/**
 * Screen 5: In-Area (Widget Selection Panel)
 * Layout: circuit controls, content tools, and area tools.
 */
export class InAreaScreen {
  private container: SceneObject
  private eventBus: EventBus
  private logger: Logger
  private buttons: RectangleButton[] = []
  private managedButtons: ManagedButtonRef[] = []
  private recallTextComp: Text | null = null
  private recallActive: boolean = false
  private snapTextComp: Text | null = null
  private snapActive: boolean = false
  private layerButtons: LayerButtonRef[] = []
  private followTextComp: Text | null = null
  private followButton: RectangleButton | null = null
  private nextStepTextComp: Text | null = null
  private nextStepButton: RectangleButton | null = null
  private followActive: boolean = false
  private localizationStatusComp: Text | null = null
  private localizationBaseText: string = "Searching for area..."
  private lastScanFrame: number = -1
  private areaReady: boolean = false
  private routeSummaryComp: Text | null = null
  private instructionTextComp: Text | null = null
  private selectedCircuitName: string = DEFAULT_CIRCUITS[0].name

  constructor(parent: SceneObject, eventBus: EventBus, logger: Logger) {
    this.eventBus = eventBus
    this.logger = logger

    this.container = global.scene.createSceneObject("InAreaScreen")
    this.container.setParent(parent)

    this.buildLocalizationStatus()
    this.buildInstructionText()
    this.buildRouteSummary()
    this.buildPrimaryRow()
    this.buildLayerRow()
    this.buildFollowRow()
    this.buildUtilityRow()
    this.buildScanAnimationTicker()
    this.setCircuitName(DEFAULT_CIRCUITS[0].name)
    this.setAreaReady(false)

    this.logger.debug("InAreaScreen built")
  }

  show(): void {
    this.container.enabled = true
  }

  hide(): void {
    this.container.enabled = false
  }

  destroy(): void {
    this.container.destroy()
  }

  getContainer(): SceneObject {
    return this.container
  }

  /** Called by AppController after recall toggle to update button label */
  setRecallActive(active: boolean): void {
    this.recallActive = active
    if (this.recallTextComp) {
      this.recallTextComp.text = active ? "Release" : "Gather"
    }
  }

  setSnapActive(active: boolean): void {
    this.snapActive = active
    if (this.snapTextComp) {
      this.snapTextComp.text = active ? "Snap On" : "Snap"
    }
  }

  setCircuitName(name: string): void {
    this.selectedCircuitName = name
    this.applyButtonAvailability()
    this.refreshLayerButtons()
  }

  private refreshLayerButtons(): void {
    for (const layer of this.layerButtons) {
      const active = layer.name === this.selectedCircuitName
      ;(layer.btn as any)._style = active ? "Primary" : "PrimaryNeutral"
      layer.text.text = active ? `${layer.name}\nON` : layer.name
      layer.text.size = active ? 22 : 21
      layer.text.textFill.color = this.areaReady && !this.followActive
        ? active
          ? new vec4(1, 0.92, 0.45, 1)
          : new vec4(1, 1, 1, 0.9)
        : new vec4(0.62, 0.66, 0.7, 0.72)
    }
  }

  setFollowActive(active: boolean): void {
    this.followActive = active
    this.updateModeCopy()
    this.applyButtonAvailability()
    this.refreshLayerButtons()
    if (this.followTextComp) {
      this.followTextComp.text = active ? "Stop Path" : "Follow Path"
      this.followTextComp.textFill.color = !this.areaReady
        ? new vec4(0.62, 0.66, 0.7, 0.72)
        : active
        ? new vec4(1, 0.92, 0.45, 1)
        : new vec4(1, 1, 1, 1)
    }
    if (this.followButton) {
      ;(this.followButton as any)._style = active
        ? "Primary"
        : "PrimaryNeutral"
    }
    if (this.nextStepTextComp) {
      this.nextStepTextComp.textFill.color = !this.areaReady || !active
        ? new vec4(0.62, 0.66, 0.7, 0.72)
        : new vec4(1, 0.92, 0.45, 1)
    }
    if (this.nextStepButton) {
      ;(this.nextStepButton as any)._style = active
        ? "Primary"
        : "PrimaryNeutral"
    }
  }

  setLocalizationStatus(text: string): void {
    this.localizationBaseText = text
    this.updateLocalizationVisual(true)
  }

  setAreaReady(ready: boolean): void {
    this.areaReady = ready
    this.lastScanFrame = -1
    this.applyButtonAvailability()
    this.refreshLayerButtons()
    this.updateLocalizationVisual(true)
  }

  setRouteSummary(text: string): void {
    if (this.routeSummaryComp) {
      this.routeSummaryComp.text = text
    }
  }

  // ── Internal ───────────────────────────────────────────

  private buildLocalizationStatus(): void {
    const textObj = global.scene.createSceneObject("LocalizationStatus")
    textObj.setParent(this.container)
    this.localizationStatusComp = textObj.createComponent("Component.Text") as Text
    this.localizationStatusComp.text = this.localizationBaseText
    this.localizationStatusComp.size = 31
    this.localizationStatusComp.worldSpaceRect = Rect.create(-20.5, 20.5, -1.75, 1.75)
    this.localizationStatusComp.horizontalOverflow = HorizontalOverflow.Wrap
    this.localizationStatusComp.verticalOverflow = VerticalOverflow.Shrink
    this.localizationStatusComp.horizontalAlignment = HorizontalAlignment.Center
    this.localizationStatusComp.verticalAlignment = VerticalAlignment.Center
    this.localizationStatusComp.textFill.mode = TextFillMode.Solid
    this.localizationStatusComp.textFill.color = new vec4(1, 0.85, 0.4, 1)
    this.localizationStatusComp.renderOrder = 10
    textObj.getTransform().setLocalPosition(new vec3(0, 14.6, 2))
  }

  private buildInstructionText(): void {
    const textObj = global.scene.createSceneObject("InAreaInstructions")
    textObj.setParent(this.container)
    this.instructionTextComp = textObj.createComponent("Component.Text") as Text
    this.instructionTextComp.text = INSTRUCTION_TEXT
    this.instructionTextComp.size = 29
    this.instructionTextComp.worldSpaceRect = Rect.create(-20.5, 20.5, -1.35, 1.35)
    this.instructionTextComp.horizontalOverflow = HorizontalOverflow.Wrap
    this.instructionTextComp.verticalOverflow = VerticalOverflow.Overflow
    this.instructionTextComp.horizontalAlignment = HorizontalAlignment.Left
    this.instructionTextComp.verticalAlignment = VerticalAlignment.Center
    this.instructionTextComp.textFill.mode = TextFillMode.Solid
    this.instructionTextComp.textFill.color = new vec4(1, 1, 1, 1)
    this.instructionTextComp.renderOrder = 10

    textObj.getTransform().setLocalPosition(new vec3(0, 11.45, 2))
  }

  private buildRouteSummary(): void {
    const textObj = global.scene.createSceneObject("CircuitRouteSummary")
    textObj.setParent(this.container)
    this.routeSummaryComp = textObj.createComponent("Component.Text") as Text
    this.routeSummaryComp.text = "Story 1: no steps yet.\nStep + marks the route. Box+ highlights objects."
    this.routeSummaryComp.size = 25
    this.routeSummaryComp.worldSpaceRect = Rect.create(-20.5, 20.5, -1.55, 1.55)
    this.routeSummaryComp.horizontalOverflow = HorizontalOverflow.Wrap
    this.routeSummaryComp.verticalOverflow = VerticalOverflow.Shrink
    this.routeSummaryComp.horizontalAlignment = HorizontalAlignment.Left
    this.routeSummaryComp.verticalAlignment = VerticalAlignment.Center
    this.routeSummaryComp.textFill.mode = TextFillMode.Solid
    this.routeSummaryComp.textFill.color = new vec4(0.72, 0.95, 1, 0.95)
    this.routeSummaryComp.renderOrder = 10
    textObj.getTransform().setLocalPosition(new vec3(0, 8.45, 2))
  }

  private buildPrimaryRow(): void {
    const primaryButtons: ButtonConfig[] = [
      {
        label: "Step +",
        event: "addCircuitStep",
        style: "Primary",
        fontSize: 34,
        requiresAreaReady: true,
        disabledWhenFollowing: true,
      },
      {
        label: "Box +",
        event: "toggleStepObjectFrame",
        style: "PrimaryNeutral",
        fontSize: 30,
        requiresAreaReady: true,
        disabledWhenFollowing: true,
      },
      {
        label: "Note +",
        event: "spawnWidget",
        style: "Primary",
        fontSize: 34,
        requiresAreaReady: true,
        disabledWhenFollowing: true,
      },
    ]
    this.buildGridRow("PrimaryGrid", primaryButtons, new vec3(0, 3.9, 2), new vec2(13.6, 6.4), 3)
  }

  private buildLayerRow(): void {
    const layerButtons: ButtonConfig[] = DEFAULT_CIRCUITS.map((circuit, index) => ({
      label: circuit.name,
      event: "selectCircuit",
      style: index === 0 ? "Primary" : "PrimaryNeutral",
      fontSize: 24,
      payload: {index},
      requiresAreaReady: true,
      disabledWhenFollowing: true,
    }))

    this.buildGridRow("LayerGrid", layerButtons, new vec3(0, -2.45, 2), new vec2(13.2, 4.7), 3)
  }

  private buildFollowRow(): void {
    const followButtons: ButtonConfig[] = [
      {label: "Follow Path", event: "toggleCircuitFollow", fontSize: 26, requiresAreaReady: true},
      {
        label: "Next Step",
        event: "advanceCircuitStep",
        fontSize: 25,
        requiresAreaReady: true,
        requiresFollowActive: true,
      },
    ]
    this.buildGridRow("FollowGrid", followButtons, new vec3(0, -7.35, 2), new vec2(15.5, 4.8), 2)
  }

  private buildUtilityRow(): void {
    const utilityButtons: ButtonConfig[] = [
      {label: "Gather", event: "recallWidgets", fontSize: 22, requiresAreaReady: true, disabledWhenFollowing: true},
      {label: "Snap", event: "toggleSnapToSurface", fontSize: 22, requiresAreaReady: true, disabledWhenFollowing: true},
      {label: "Hide Panel", event: "toggleMainPanelMinimized", fontSize: 20},
      {label: "Exit", event: "exitArea", fontSize: 22},
    ]
    this.buildGridRow("UtilityGrid", utilityButtons, new vec3(0, -12.8, 2), new vec2(10.2, 4.7), 4)
  }

  private buildGridRow(
    name: string,
    items: ButtonConfig[],
    position: vec3,
    cellSize: vec2,
    columns: number
  ): void {
    const gridObj = global.scene.createSceneObject(name)
    gridObj.setParent(this.container)
    gridObj.getTransform().setLocalPosition(position)

    // Create button children FIRST
    for (let i = 0; i < items.length; i++) {
      const config = items[i]
      const btnObj = global.scene.createSceneObject(`Btn_${config.label.replace(/\s/g, "")}`)
      btnObj.setParent(gridObj)

      const btn = btnObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
      ;(btn as any)._style = config.style ?? "PrimaryNeutral"
      const btnW = cellSize.x - 1
      const btnH = cellSize.y - 1
      btn.size = new vec3(btnW, btnH, 1)
      btn.renderOrder = 10
      btn.initialize()
      const textComp = addButtonLabel(
        btnObj,
        config.label,
        btnW,
        btnH,
        config.fontSize ?? 24
      )

      // Track the Minimize/Release button text
      if (config.label === "Gather") {
        this.recallTextComp = textComp
      }

      if (config.label === "Snap") {
        this.snapTextComp = textComp
      }

      const layerIndex = DEFAULT_CIRCUITS.findIndex((circuit) => circuit.name === config.label)
      if (layerIndex >= 0) {
        this.layerButtons.push({
          name: config.label,
          btn,
          text: textComp,
        })
      }

      if (config.label === "Follow Path") {
        this.followTextComp = textComp
        this.followButton = btn
      }

      if (config.label === "Next Step") {
        this.nextStepTextComp = textComp
        this.nextStepButton = btn
      }

      const buttonConfig = config
      btn.onTriggerUp.add(() => {
        this.logger.debug(`InArea button pressed: ${buttonConfig.label}`)
        const widgetType = WIDGET_TYPE_MAP[buttonConfig.label]
        if (widgetType) {
          this.eventBus.emit(buttonConfig.event, {type: widgetType})
        } else if (buttonConfig.payload !== undefined) {
          this.eventBus.emit(buttonConfig.event, buttonConfig.payload)
        } else {
          this.eventBus.emit(buttonConfig.event)
        }
      })

      this.buttons.push(btn)
      this.managedButtons.push({
        label: config.label,
        btn,
        text: textComp,
        requiresAreaReady: config.requiresAreaReady === true,
        requiresFollowActive: config.requiresFollowActive === true,
        disabledWhenFollowing: config.disabledWhenFollowing === true,
      })
    }

    // Create GridLayout AFTER children
    const grid = gridObj.createComponent(GridLayout.getTypeName()) as GridLayout
    grid.rows = 1
    grid.columns = columns
    grid.cellSize = cellSize
    grid.initialize()
    grid.layout()
  }

  private buildScanAnimationTicker(): void {
    const tickerObj = global.scene.createSceneObject("InAreaScanTicker")
    tickerObj.setParent(this.container)
    const scriptComponent = tickerObj.createComponent("ScriptComponent") as ScriptComponent
    const updateEvent = scriptComponent.createEvent("UpdateEvent") as SceneEvent
    updateEvent.bind(() => {
      if (!this.container.enabled || this.areaReady) return
      this.updateLocalizationVisual(false)
    })
  }

  private updateLocalizationVisual(force: boolean): void {
    if (!this.localizationStatusComp) return

    if (this.areaReady) {
      this.localizationStatusComp.text = this.localizationBaseText
      this.localizationStatusComp.size = 32
      this.localizationStatusComp.textFill.color = new vec4(0.72, 0.95, 1, 0.96)
      return
    }

    const frames = ["[>    ]", "[=>   ]", "[==>  ]", "[===> ]", "[====>]"]
    const frame = Math.floor(getTime() * 5) % frames.length
    if (!force && frame === this.lastScanFrame) return
    this.lastScanFrame = frame

    this.localizationStatusComp.text =
      `${this.localizationBaseText}\n${frames[frame]} scanning`
    this.localizationStatusComp.size = 25
    this.localizationStatusComp.textFill.color = new vec4(1, 0.84, 0.38, 1)
  }

  private applyButtonAvailability(): void {
    const disabledColor = new vec4(0.62, 0.66, 0.7, 0.72)
    const enabledColor = new vec4(1, 1, 1, 1)

    for (const button of this.managedButtons) {
      const locked =
        (button.requiresAreaReady && !this.areaReady) ||
        (button.requiresFollowActive && !this.followActive) ||
        (button.disabledWhenFollowing && this.followActive)
      button.btn.inactive = locked
      if (locked) {
        button.text.textFill.color = disabledColor
      } else if (button.label === "Next Step" && this.followActive) {
        button.text.textFill.color = new vec4(1, 0.92, 0.45, 1)
      } else if (button.label !== "Follow Path") {
        button.text.textFill.color = enabledColor
      }
    }
  }

  private updateModeCopy(): void {
    if (!this.instructionTextComp) return
    this.instructionTextComp.text = this.followActive
      ? FOLLOW_INSTRUCTION_TEXT
      : INSTRUCTION_TEXT
    this.instructionTextComp.textFill.color = this.followActive
      ? new vec4(1, 0.92, 0.45, 1)
      : new vec4(1, 1, 1, 1)
  }
}
