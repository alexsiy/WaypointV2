import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {GridLayout} from "SpectaclesUIKit.lspkg/Scripts/Components/GridLayout/GridLayout"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {EventBus} from "../../Shared/EventBus"
import {addButtonLabel} from "../../Shared/ButtonTextHelper"
import {DEFAULT_CIRCUITS} from "../../Circuits/CircuitTypes"

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
  requiresFollowAvailable?: boolean
  disabledWhenFollowing?: boolean
}

interface LayerButtonRef {
  index: number
  btn: RectangleButton
  text: Text
}

interface ManagedButtonRef {
  label: string
  btn: RectangleButton
  text: Text
  requiresAreaReady: boolean
  requiresFollowActive: boolean
  requiresFollowAvailable: boolean
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
  private createCircuitTextComp: Text | null = null
  private createCircuitButton: RectangleButton | null = null
  private createModeActive: boolean = false
  private createModeHeaderComp: Text | null = null
  private createModeRoots: SceneObject[] = []
  private followModeRoots: SceneObject[] = []
  private selectedCircuitName: string = DEFAULT_CIRCUITS[0].name
  private selectedCircuitIndex: number = 0
  private circuitStepCounts: number[] = DEFAULT_CIRCUITS.map(() => 0)
  private followAvailable: boolean = false
  private createCircuitHighlighted: boolean = false
  private followHeadingComp: Text | null = null
  private boldFont: Font | null = null
  private circuitLogoTexture: Texture | null = null

  constructor(parent: SceneObject, eventBus: EventBus, logger: Logger) {
    this.eventBus = eventBus
    this.logger = logger

    this.container = global.scene.createSceneObject("InAreaScreen")
    this.container.setParent(parent)

    this.buildLocalizationStatus()
    this.buildRouteSummary()
    this.buildFollowHeading()
    this.buildLayerRow()
    this.buildActionRow()
    this.buildCreateModePanel()
    this.buildExitButton()
    this.buildScanAnimationTicker()
    this.setCircuitName(DEFAULT_CIRCUITS[0].name)
    this.setCreateMode(false, 0)
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
    const idx = DEFAULT_CIRCUITS.findIndex((c) => c.name === name)
    this.selectedCircuitIndex = idx >= 0 ? idx : 0
    this.refreshFollowHeading()
    this.applyButtonAvailability()
    this.refreshLayerButtons()
  }

  setCircuitStepCounts(counts: number[]): void {
    this.circuitStepCounts = DEFAULT_CIRCUITS.map((_circuit, index) =>
      Math.max(0, counts[index] ?? 0)
    )
    this.refreshLayerButtons()
  }

  setFollowAvailable(available: boolean): void {
    this.followAvailable = available
    this.applyButtonAvailability()
    this.refreshLayerButtons()
  }

  private refreshLayerButtons(): void {
    for (const layer of this.layerButtons) {
      const active = layer.index === this.selectedCircuitIndex
      const stepCount = this.circuitStepCounts[layer.index] ?? 0
      const hasSteps = stepCount > 0
      ;(layer.btn as any)._style = "PrimaryNeutral"
      layer.text.text = `${layer.index + 1}`
      layer.text.size = active
        ? hasSteps
          ? 44
          : 40
        : hasSteps
          ? 40
          : 34
      layer.text.textFill.color =
        this.areaReady && !this.followActive
          ? active
            ? hasSteps
              ? new vec4(1, 1, 1, 1)
              : new vec4(1, 0.9, 0.35, 0.78)
            : hasSteps
              ? new vec4(1, 1, 1, 0.88)
              : new vec4(0.62, 0.66, 0.7, 0.48)
          : new vec4(0.62, 0.66, 0.7, 0.72)
    }
    if (this.createCircuitTextComp) {
      this.createCircuitTextComp.text = "Create"
    }
  }

  setFollowActive(active: boolean): void {
    this.followActive = active
    this.refreshFollowHeading()
    this.applyButtonAvailability()
    this.refreshLayerButtons()
    if (this.followTextComp) {
      this.followTextComp.text = active ? "Stop" : "Follow"
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
    this.localizationBaseText = /area ready \(editor\)/i.test(text) ? "" : text
    this.updateLocalizationVisual(true)
  }

  setAreaReady(ready: boolean): void {
    this.areaReady = ready
    this.lastScanFrame = -1
    this.refreshFollowHeading()
    this.applyModeVisibility()
    this.applyButtonAvailability()
    this.refreshLayerButtons()
    this.updateLocalizationVisual(true)
  }

  setRouteSummary(text: string): void {
    if (this.routeSummaryComp) {
      this.routeSummaryComp.text = text
    }
  }

  setCreateCircuitHighlighted(highlighted: boolean): void {
    this.createCircuitHighlighted = highlighted
    this.applyButtonAvailability()
  }

  setCreateMode(active: boolean, circuitIndex: number): void {
    this.createModeActive = active
    this.selectedCircuitIndex = Math.max(0, circuitIndex)
    if (this.createModeHeaderComp) {
      this.createModeHeaderComp.text = `CREATING STORY ${this.selectedCircuitIndex + 1}`
    }
    this.applyModeVisibility()
    this.refreshFollowHeading()
    this.refreshLayerButtons()
    this.applyButtonAvailability()
  }

  // ── Internal ───────────────────────────────────────────

  private buildLocalizationStatus(): void {
    const textObj = global.scene.createSceneObject("LocalizationStatus")
    textObj.setParent(this.container)
    this.localizationStatusComp = textObj.createComponent("Component.Text") as Text
    this.localizationStatusComp.text = this.localizationBaseText
    this.localizationStatusComp.size = 31
    this.localizationStatusComp.worldSpaceRect = Rect.create(-10.5, 10.5, -1.65, 1.65)
    this.localizationStatusComp.horizontalOverflow = HorizontalOverflow.Wrap
    this.localizationStatusComp.verticalOverflow = VerticalOverflow.Shrink
    this.localizationStatusComp.horizontalAlignment = HorizontalAlignment.Center
    this.localizationStatusComp.verticalAlignment = VerticalAlignment.Center
    this.localizationStatusComp.textFill.mode = TextFillMode.Solid
    this.localizationStatusComp.textFill.color = new vec4(1, 0.85, 0.4, 1)
    this.localizationStatusComp.renderOrder = 10
    textObj.getTransform().setLocalPosition(new vec3(0, 3.05, 2))
  }

  private buildRouteSummary(): void {
    const textObj = global.scene.createSceneObject("CircuitRouteSummary")
    textObj.setParent(this.container)
    this.routeSummaryComp = textObj.createComponent("Component.Text") as Text
    this.routeSummaryComp.text = "Authoring · Step 0/0\nNo steps yet. Tap Create to add Step 1."
    this.routeSummaryComp.size = 26
    this.routeSummaryComp.worldSpaceRect = Rect.create(-10.6, 10.6, -1.25, 1.25)
    this.routeSummaryComp.horizontalOverflow = HorizontalOverflow.Wrap
    this.routeSummaryComp.verticalOverflow = VerticalOverflow.Shrink
    this.routeSummaryComp.horizontalAlignment = HorizontalAlignment.Center
    this.routeSummaryComp.verticalAlignment = VerticalAlignment.Center
    this.routeSummaryComp.textFill.mode = TextFillMode.Solid
    this.routeSummaryComp.textFill.color = new vec4(1, 1, 1, 0.95)
    this.routeSummaryComp.renderOrder = 10
    textObj.getTransform().setLocalPosition(new vec3(0, 3.35, 2))
  }

  private buildFollowHeading(): void {
    const textObj = global.scene.createSceneObject("FollowCircuitHeading")
    textObj.setParent(this.container)
    this.followModeRoots.push(textObj)
    this.followHeadingComp = textObj.createComponent("Component.Text") as Text
    this.followHeadingComp.text = "MAPPING AREA"
    this.followHeadingComp.size = 46
    this.followHeadingComp.worldSpaceRect = Rect.create(-10.8, 10.8, -1.05, 1.05)
    this.followHeadingComp.horizontalOverflow = HorizontalOverflow.Wrap
    this.followHeadingComp.verticalOverflow = VerticalOverflow.Overflow
    this.followHeadingComp.horizontalAlignment = HorizontalAlignment.Center
    this.followHeadingComp.verticalAlignment = VerticalAlignment.Center
    this.followHeadingComp.textFill.mode = TextFillMode.Solid
    this.followHeadingComp.textFill.color = new vec4(1, 1, 1, 1)
    this.followHeadingComp.renderOrder = 10
    const bold = this.getBoldFont()
    if (bold) {
      this.followHeadingComp.font = bold
    }
    textObj.getTransform().setLocalPosition(new vec3(0, 5.55, 2))
  }

  private buildLayerRow(): void {
    const layerButtons: ButtonConfig[] = DEFAULT_CIRCUITS.map((_circuit, index) => ({
      label: `Circuit ${index + 1}`,
      event: "selectCircuit",
      style: "PrimaryNeutral",
      fontSize: 40,
      payload: {index},
      requiresAreaReady: true,
      disabledWhenFollowing: true,
    }))

    this.buildGridRow("LayerGrid", layerButtons, new vec3(0, -1.0, 2), new vec2(7.05, 7.25), 3)
  }

  private buildActionRow(): void {
    const actionButtons: ButtonConfig[] = [
      {
        label: "Create",
        event: "startCreateCircuit",
        style: "PrimaryNeutral",
        fontSize: 25,
        requiresAreaReady: true,
        disabledWhenFollowing: true,
      },
      {
        label: "Follow",
        event: "toggleCircuitFollow",
        style: "PrimaryNeutral",
        fontSize: 25,
        requiresAreaReady: true,
        requiresFollowAvailable: true,
      },
      {
        label: "Next",
        event: "advanceCircuitStep",
        style: "PrimaryNeutral",
        fontSize: 25,
        requiresAreaReady: true,
        requiresFollowActive: true,
      },
    ]
    this.buildGridRow(
      "CircuitActionGrid",
      actionButtons,
      new vec3(0, -5.75, 2),
      new vec2(7.1, 3.7),
      3
    )
  }

  private buildCreateModePanel(): void {
    const headerObj = global.scene.createSceneObject("CreateModeHeading")
    headerObj.setParent(this.container)
    this.createModeRoots.push(headerObj)
    this.createModeHeaderComp = headerObj.createComponent("Component.Text") as Text
    this.createModeHeaderComp.text = "CREATING STORY 1"
    this.createModeHeaderComp.size = 46
    this.createModeHeaderComp.worldSpaceRect = Rect.create(-16.5, 16.5, -1.3, 1.3)
    this.createModeHeaderComp.horizontalOverflow = HorizontalOverflow.Wrap
    this.createModeHeaderComp.verticalOverflow = VerticalOverflow.Overflow
    this.createModeHeaderComp.horizontalAlignment = HorizontalAlignment.Center
    this.createModeHeaderComp.verticalAlignment = VerticalAlignment.Center
    this.createModeHeaderComp.textFill.mode = TextFillMode.Solid
    this.createModeHeaderComp.textFill.color = new vec4(1, 1, 1, 1)
    this.createModeHeaderComp.renderOrder = 10
    const bold = this.getBoldFont()
    if (bold) {
      this.createModeHeaderComp.font = bold
    }
    headerObj.getTransform().setLocalPosition(new vec3(0, 5.0, 2))

    this.buildGridRow(
      "CreateModeAddNote",
      [
        {
          label: "Add Note Above",
          event: "addNoteToCurrentStep",
          style: "PrimaryNeutral",
          fontSize: 32,
          requiresAreaReady: true,
          disabledWhenFollowing: true,
        },
      ],
      new vec3(0, 1.0, 2),
      new vec2(13.2, 3.5),
      1
    )
    this.buildGridRow(
      "CreateModeNext",
      [
        {
          label: "Next Step",
          event: "nextCreateStep",
          style: "PrimaryNeutral",
          fontSize: 34,
          requiresAreaReady: true,
          disabledWhenFollowing: true,
        },
      ],
      new vec3(0, -2.45, 2),
      new vec2(13.2, 3.5),
      1
    )
    this.buildGridRow(
      "CreateModeFinish",
      [
        {
          label: "Finish",
          event: "finishCreateCircuit",
          style: "Primary",
          fontSize: 34,
          requiresAreaReady: true,
          disabledWhenFollowing: true,
        },
      ],
      new vec3(0, -5.9, 2),
      new vec2(13.2, 3.5),
      1
    )
  }

  private buildExitButton(): void {
    const exitObj = global.scene.createSceneObject("ExitAreaButton")
    exitObj.setParent(this.container)
    exitObj.getTransform().setLocalPosition(new vec3(10.1, 6.1, 2))

    const btn = exitObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
    ;(btn as any)._style = "Primary"
    btn.size = new vec3(2.2, 2.2, 1)
    btn.renderOrder = 10
    btn.initialize()

    const textComp = addButtonLabel(exitObj, "X", 2.2, 2.2, 30)
    textComp.textFill.color = new vec4(1, 0.2, 0.2, 1)

    btn.onTriggerUp.add(() => {
      this.logger.debug("InArea button pressed: Exit")
      this.eventBus.emit("exitArea")
    })

    this.buttons.push(btn)
    this.managedButtons.push({
      label: "Exit",
      btn,
      text: textComp,
      requiresAreaReady: false,
      requiresFollowActive: false,
      requiresFollowAvailable: false,
      disabledWhenFollowing: false,
    })
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
    if (name === "LayerGrid" || name === "CircuitActionGrid") {
      this.followModeRoots.push(gridObj)
    } else if (name.indexOf("CreateMode") === 0) {
      this.createModeRoots.push(gridObj)
    }
    gridObj.getTransform().setLocalPosition(position)

    // Create button children FIRST
    for (let i = 0; i < items.length; i++) {
      const config = items[i]
      const btnObj = global.scene.createSceneObject(`Btn_${config.label.replace(/\s/g, "")}`)
      btnObj.setParent(gridObj)

      const btn = btnObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
      ;(btn as any)._style = config.style ?? "PrimaryNeutral"
      const isCircuitRow = name === "LayerGrid"
      const btnW = isCircuitRow ? 5.8 : cellSize.x - 1
      const btnH = isCircuitRow ? 5.8 : cellSize.y - 1
      btn.size = new vec3(btnW, btnH, 1)
      btn.renderOrder = 10
      btn.initialize()
      let textComp: Text
      if (/^Circuit \d+$/.test(config.label)) {
        const layerIndex = parseInt(config.label.replace("Circuit ", ""), 10) - 1
        textComp = this.createCircuitBadgeButton(btnObj, btnW, btnH, Math.max(0, layerIndex))
      } else {
        textComp = addButtonLabel(
          btnObj,
          config.label,
          btnW,
          btnH,
          config.fontSize ?? 24
        )
      }

      // Track the Minimize/Release button text
      if (config.label === "Gather") {
        this.recallTextComp = textComp
      }

      if (config.label === "Snap") {
        this.snapTextComp = textComp
      }

      if (/^Circuit \d+$/.test(config.label)) {
        const layerIndex = parseInt(config.label.replace("Circuit ", ""), 10) - 1
        this.layerButtons.push({
          index: Math.max(0, layerIndex),
          btn,
          text: textComp,
        })
      }

      if (config.event === "startCreateCircuit") {
        this.createCircuitTextComp = textComp
        this.createCircuitButton = btn
      }

      if (config.event === "toggleCircuitFollow") {
        this.followTextComp = textComp
        this.followButton = btn
      }

      if (config.event === "advanceCircuitStep") {
        this.nextStepTextComp = textComp
        this.nextStepButton = btn
      }

      const buttonConfig = config
      btn.onTriggerUp.add(() => {
        this.logger.debug(`InArea button pressed: ${buttonConfig.label}`)
        const widgetType = WIDGET_TYPE_MAP[buttonConfig.label]
        if (widgetType) {
          this.eventBus.emit(buttonConfig.event, {type: widgetType})
        } else if (
          buttonConfig.event === "selectCircuit" &&
          buttonConfig.payload &&
          typeof (buttonConfig.payload as {index?: number}).index === "number"
        ) {
          this.selectedCircuitIndex = (buttonConfig.payload as {index: number}).index
          this.refreshLayerButtons()
          this.eventBus.emit(buttonConfig.event, buttonConfig.payload)
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
        requiresFollowAvailable: config.requiresFollowAvailable === true,
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

  private createCircuitBadgeButton(
    btnObj: SceneObject,
    btnWidth: number,
    btnHeight: number,
    layerIndex: number
  ): Text {
    const logoObj = global.scene.createSceneObject("CircuitLogo")
    logoObj.setParent(btnObj)
    logoObj.getTransform().setLocalPosition(new vec3(0, 0, 0.08))

    const logo = logoObj.createComponent("Component.Image") as Image
    const logoSize = Math.min(btnWidth, btnHeight) - 1.8
    const half = logoSize * 0.5
    logoObj.getTransform().setLocalScale(new vec3(logoSize, logoSize, 1))
    logo.renderOrder = 10

    // Runtime-created Image components can have null mainPass until a material is assigned.
    // If an existing "Circuit Logo" image is present in the scene, reuse its material.
    const sourceLogoImage = this.findLogoImageInScene()
    if (sourceLogoImage && sourceLogoImage.mainMaterial) {
      logo.mainMaterial = sourceLogoImage.mainMaterial
    }

    const tex = this.getCircuitLogoTexture()
    if (tex && logo.mainPass) {
      logo.mainPass.baseTex = tex
    }

    const numberObj = global.scene.createSceneObject("CircuitNumber")
    numberObj.setParent(btnObj)
    numberObj.getTransform().setLocalPosition(new vec3(0, 0, 0.12))
    const numberText = numberObj.createComponent("Component.Text") as Text
    numberText.text = `${layerIndex + 1}`
    numberText.size = 58
    numberText.worldSpaceRect = Rect.create(-half, half, -half, half)
    numberText.horizontalOverflow = HorizontalOverflow.Wrap
    numberText.verticalOverflow = VerticalOverflow.Shrink
    numberText.horizontalAlignment = HorizontalAlignment.Center
    numberText.verticalAlignment = VerticalAlignment.Center
    numberText.textFill.mode = TextFillMode.Solid
    numberText.textFill.color = new vec4(1, 1, 1, 1)
    const bold = this.getBoldFont()
    if (bold) {
      numberText.font = bold
    }
    numberText.renderOrder = 11
    return numberText
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

  private applyModeVisibility(): void {
    const showCreate = this.createModeActive
    const showFollow = !showCreate

    if (this.localizationStatusComp) {
      this.localizationStatusComp.getSceneObject().enabled =
        showFollow && !this.areaReady
    }
    if (this.routeSummaryComp) {
      this.routeSummaryComp.getSceneObject().enabled = this.areaReady
    }
    for (let i = 0; i < this.followModeRoots.length; i++) {
      this.followModeRoots[i].enabled = showFollow
    }
    for (let i = 0; i < this.createModeRoots.length; i++) {
      this.createModeRoots[i].enabled = showCreate
    }
  }

  private refreshFollowHeading(): void {
    if (!this.followHeadingComp) return

    if (!this.areaReady) {
      this.followHeadingComp.text = "MAPPING AREA"
      return
    }

    if (this.followActive) {
      this.followHeadingComp.text = `FOLLOW ${this.selectedCircuitName.toUpperCase()}`
      return
    }

    this.followHeadingComp.text = "SELECT A STORY"
  }

  private updateLocalizationVisual(force: boolean): void {
    if (!this.localizationStatusComp) return

    if (this.areaReady) {
      this.localizationStatusComp.text = ""
      this.localizationStatusComp.size = 32
      this.localizationStatusComp.textFill.color = new vec4(0.72, 0.95, 1, 0.96)
      return
    }

    const frames = ["[>    ]", "[=>   ]", "[==>  ]", "[===> ]", "[====>]"]
    const frame = Math.floor(getTime() * 5) % frames.length
    if (!force && frame === this.lastScanFrame) return
    this.lastScanFrame = frame

    this.localizationStatusComp.text =
      `${this.localizationBaseText}\n${frames[frame]} mapping`
    this.localizationStatusComp.size = 24
    this.localizationStatusComp.textFill.color = new vec4(1, 0.84, 0.38, 1)
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
        if (this.circuitLogoTexture) {
          return this.circuitLogoTexture
        }
      } catch (_e) {
        // Continue trying other candidates.
      }
    }

    // Fallback: if a scene object named "Circuit Logo" exists and has an Image component,
    // reuse its currently assigned texture.
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

  private applyButtonAvailability(): void {
    const disabledColor = new vec4(0.62, 0.66, 0.7, 0.72)
    const enabledColor = new vec4(1, 1, 1, 1)

    for (const button of this.managedButtons) {
      const locked =
        (button.requiresAreaReady && !this.areaReady) ||
        (button.requiresFollowActive && !this.followActive) ||
        (button.requiresFollowAvailable && !this.followAvailable) ||
        (button.disabledWhenFollowing && this.followActive)
      button.btn.inactive = locked
      if (locked) {
        button.text.textFill.color = disabledColor
      } else if (button.requiresFollowActive && this.followActive) {
        button.text.textFill.color = new vec4(1, 0.92, 0.45, 1)
      } else if (button.label === "Follow") {
        button.text.textFill.color = this.followActive
          ? new vec4(1, 0.92, 0.45, 1)
          : enabledColor
      } else {
        button.text.textFill.color = enabledColor
      }
    }

    if (this.createCircuitButton && this.createCircuitTextComp) {
      const canHighlight =
        this.createCircuitHighlighted &&
        this.areaReady &&
        !this.followActive &&
        !this.createCircuitButton.inactive
      ;(this.createCircuitButton as any)._style = canHighlight
        ? "Primary"
        : "PrimaryNeutral"
      this.createCircuitTextComp.textFill.color = canHighlight
        ? new vec4(1, 0.92, 0.45, 1)
        : this.createCircuitButton.inactive
          ? disabledColor
          : enabledColor
    }
  }

}
