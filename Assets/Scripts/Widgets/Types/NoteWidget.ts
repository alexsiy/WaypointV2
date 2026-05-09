import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"
import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {WidgetBase} from "../WidgetBase"
import {CircuitStepMeta} from "../../Circuits/CircuitTypes"
import {addButtonLabel} from "../../Shared/ButtonTextHelper"

export interface NoteObjectFrameVec3Data {
  x: number
  y: number
  z: number
}

export interface NoteObjectFrameVec2Data {
  x: number
  y: number
}

export interface NoteObjectFrameData {
  enabled: boolean
  position: NoteObjectFrameVec3Data
  rotation: NoteObjectFrameVec3Data
  size: NoteObjectFrameVec2Data
}

interface NoteData {
  text: string
  circuit?: CircuitStepMeta
  minimized?: boolean
  objectFrame?: NoteObjectFrameData
}

const NOTE_MIN_SIZE = new vec2(15, 9.5)
const NOTE_MAX_SIZE = new vec2(32, 26)
const NOTE_MINIMIZED_SIZE = new vec2(8.8, 4.4)
const NOTE_MINIMIZE_BUTTON_SIZE = new vec2(2.8, 2.4)
const NOTE_RESTORE_BUTTON_SIZE = new vec2(7.2, 3)

/**
 * Note Widget — sticky note with editable text.
 * Wire the Text child and the TextInputField SceneObject in the inspector.
 * Frame is added manually on the prefab.
 */
@component
export class NoteWidget extends WidgetBase {
  @ui.label(
    '<span style="color: #60A5FA;">NoteWidget – Sticky note with editable text</span>'
  )
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Text component displaying the note content")
  textComponent: Text

  @input
  @hint("SceneObject that has the TextInputField component")
  inputFieldObject: SceneObject

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging")
  enableLoggingLifecycle: boolean = false

  private noteText: string = ""
  private circuitStep: CircuitStepMeta | null = null
  private inputField: TextInputField | null = null
  private guideState: "none" | "upcoming" | "active" | "visited" = "none"
  private editingEnabled: boolean = true
  private minimized: boolean = false
  private objectFrame: NoteObjectFrameData | null = null
  private minimizeButton: RectangleButton | null = null
  private minimizeButtonObject: SceneObject | null = null
  private minimizeButtonText: Text | null = null

  onAwake(): void {
    super.onAwake()
    this.logger = new Logger(
      "NoteWidget",
      this.enableLogging || this.enableLoggingLifecycle,
      true
    )

    this.minimized = false

    if (this.textComponent) {
      this.textComponent.text = this.getDisplayText()
      this.applyResponsiveLayout()
    }

    // Defer input field binding to OnStartEvent so TextInputField has initialized its events
    const startEvent = this.createEvent("OnStartEvent") as OnStartEvent
    startEvent.bind(() => this.bindInputField())

    this.logger.debug("NoteWidget initialized")
  }

  private bindInputField(): void {
    if (this.inputFieldObject) {
      this.inputField = this.inputFieldObject.getComponent(
        TextInputField.getTypeName()
      ) as TextInputField
    }

    if (this.inputField) {
      this.applyResponsiveLayout()
      this.inputField.onReturnKeyPressed.add((text: string) => {
        this.setText(text)
        this.logger.debug("Note text updated via return key: " + text)
      })

      this.inputField.onTextChanged.add((text: string) => {
        this.noteText = text
        if (this.textComponent) {
          this.textComponent.text = this.getDisplayText()
        }
        this.applyResponsiveLayout()
        this.emitContentChange()
      })

      this.logger.debug("TextInputField bound")
    }
  }

  get serializedContent(): string {
    const data: NoteData = {
      text: this.noteText,
      minimized: false,
    }
    if (this.circuitStep) {
      data.circuit = this.circuitStep
    }
    if (this.objectFrame) {
      data.objectFrame = this.objectFrame
    }
    return JSON.stringify(data)
  }

  set serializedContent(value: string) {
    try {
      const data: NoteData = JSON.parse(value)
      this.noteText = data.text ?? ""
      this.circuitStep = data.circuit ?? null
      this.minimized = false
      this.objectFrame = data.objectFrame ?? null
      if (this.textComponent) {
        this.textComponent.text = this.getDisplayText()
        this.applyResponsiveLayout()
      }
      if (this.inputField) {
        this.inputField.text = this.noteText
      }
    } catch (e) {
      this.logger.warn("serializedContent parse error: " + e)
    }
  }

  setText(text: string): void {
    this.noteText = text
    if (this.textComponent) {
      this.textComponent.text = this.getDisplayText()
    }
    this.applyResponsiveLayout()
    this.emitContentChange()
  }

  getText(): string {
    return this.noteText
  }

  getCircuitStep(): CircuitStepMeta | null {
    return this.circuitStep
  }

  setCircuitStep(meta: CircuitStepMeta | null): void {
    this.circuitStep = meta
    if (this.textComponent) {
      this.textComponent.text = this.getDisplayText()
    }
    this.applyResponsiveLayout()
    this.emitContentChange()
  }

  getObjectFrameData(): NoteObjectFrameData | null {
    return this.objectFrame
  }

  setObjectFrameData(
    data: NoteObjectFrameData | null,
    emitChange: boolean = true
  ): void {
    this.objectFrame = data
    if (emitChange) {
      this.emitContentChange()
    }
  }

  applyCompactLayout(): void {
    this.applyResponsiveLayout()
  }

  setEditingEnabled(enabled: boolean): void {
    this.editingEnabled = enabled
    this.applyResponsiveLayout()
  }

  applyResponsiveLayout(frameSize?: vec2): void {
    const size = frameSize ?? this.getDesiredFrameSize()
    this.applyTextStyle(size)
    this.applyInputStyle(size)
  }

  setGuideState(state: "none" | "upcoming" | "active" | "visited"): void {
    this.guideState = state
    this.applyTextColor()
  }

  getDesiredFrameSize(): vec2 {
    if (this.minimized) {
      return NOTE_MINIMIZED_SIZE
    }

    const text = this.noteText.trim()
    const length = text.length
    const width = this.clamp(15 + length * 0.1, NOTE_MIN_SIZE.x, NOTE_MAX_SIZE.x)
    const approxCharsPerLine = Math.max(10, Math.floor(width * 0.78))
    const visualLines = this.estimateLineCount(text, approxCharsPerLine)
    const height = this.clamp(
      9.5 + Math.max(0, visualLines - 1) * 2.1 + length * 0.02,
      NOTE_MIN_SIZE.y,
      NOTE_MAX_SIZE.y
    )

    return new vec2(width, height)
  }

  private applyTextStyle(frameSize: vec2): void {
    if (!this.textComponent) return
    ;(this.textComponent as any).enabled = !this.minimized
    if (this.minimized) return

    const halfW = frameSize.x * 0.5
    const halfH = frameSize.y * 0.5
    this.textComponent.text = this.noteText
    this.textComponent.size = this.getResponsiveTextSize()
    const topPadding = this.editingEnabled ? 4.6 : 1.25
    this.textComponent.worldSpaceRect = Rect.create(
      -halfW + 1.15,
      halfW - 1.15,
      -halfH + 1.15,
      halfH - topPadding
    )
    this.textComponent.horizontalOverflow = HorizontalOverflow.Wrap
    this.textComponent.verticalOverflow = VerticalOverflow.Shrink
    this.textComponent.horizontalAlignment = HorizontalAlignment.Left
    this.textComponent.verticalAlignment = VerticalAlignment.Top
    this.textComponent.textFill.mode = TextFillMode.Solid
    this.applyTextColor()
    this.textComponent.renderOrder = 10
    this.textComponent.getSceneObject().getTransform().setLocalPosition(
      new vec3(0, 0, 0.12)
    )
  }

  private applyInputStyle(frameSize: vec2): void {
    if (!this.inputField && this.inputFieldObject) {
      this.inputField = this.inputFieldObject.getComponent(
        TextInputField.getTypeName()
      ) as TextInputField
    }

    if (!this.inputField) return
    const inputWidth = Math.max(8.8, frameSize.x - 2.8)
    this.inputField.size = new vec3(inputWidth, 2.6, 1)
    this.inputField.placeholderText = ""
    this.inputField.fontSize = 24
    if (this.inputFieldObject) {
      this.inputFieldObject.enabled = !this.minimized && this.editingEnabled
    }

    if (this.inputFieldObject && !this.minimized && this.editingEnabled) {
      this.inputFieldObject.getTransform().setLocalPosition(
        new vec3(0, frameSize.y * 0.5 - 3.0, 0.12)
      )
    }
  }

  private buildMinimizeButton(): void {
    if (this.minimizeButtonObject) return

    this.minimizeButtonObject = global.scene.createSceneObject("NoteMinimizeButton")
    this.minimizeButtonObject.setParent(this.getSceneObject())

    this.minimizeButton = this.minimizeButtonObject.createComponent(RectangleButton.getTypeName()) as RectangleButton
    ;(this.minimizeButton as any)._style = "PrimaryNeutral"
    this.minimizeButton.size = new vec3(
      NOTE_MINIMIZE_BUTTON_SIZE.x,
      NOTE_MINIMIZE_BUTTON_SIZE.y,
      1
    )
    this.minimizeButton.renderOrder = 14
    this.minimizeButton.initialize()
    this.minimizeButtonText = addButtonLabel(
      this.minimizeButtonObject,
      this.getMinimizedButtonLabel(),
      NOTE_MINIMIZE_BUTTON_SIZE.x,
      NOTE_MINIMIZE_BUTTON_SIZE.y,
      22
    )
    this.minimizeButtonText.renderOrder = 15
    this.minimizeButton.onTriggerUp.add(() => {
      this.minimized = !this.minimized
      this.applyResponsiveLayout()
      this.emitContentChange()
    })
  }

  private applyMinimizeButtonStyle(frameSize: vec2): void {
    if (!this.minimizeButtonObject) return

    const buttonSize = this.minimized
      ? NOTE_RESTORE_BUTTON_SIZE
      : NOTE_MINIMIZE_BUTTON_SIZE

    if (this.minimizeButton) {
      this.minimizeButton.size = new vec3(buttonSize.x, buttonSize.y, 1)
      ;(this.minimizeButton as any)._style = this.minimized
        ? "Primary"
        : "PrimaryNeutral"
    }

    if (this.minimizeButtonText) {
      this.minimizeButtonText.text = this.minimized
        ? this.getMinimizedButtonLabel()
        : "-"
      this.minimizeButtonText.size = this.minimized ? 19 : 22
      const halfW = buttonSize.x / 2 - 0.45
      const halfH = buttonSize.y / 2 - 0.35
      this.minimizeButtonText.worldSpaceRect = Rect.create(
        -halfW,
        halfW,
        -halfH,
        halfH
      )
      this.minimizeButtonText.textFill.color = this.minimized
        ? new vec4(1, 0.92, 0.45, 1)
        : new vec4(1, 1, 1, 0.95)
    }

    const position = this.minimized
      ? new vec3(0, 0, 1.1)
      : new vec3(frameSize.x * 0.5 - 1.85, frameSize.y * 0.5 - 1.55, 0.55)
    this.minimizeButtonObject.getTransform().setLocalPosition(position)
  }

  private applyTextColor(): void {
    if (!this.textComponent) return

    if (this.guideState === "active") {
      this.textComponent.textFill.color = new vec4(1, 0.9, 0.35, 1)
    } else if (this.guideState === "visited") {
      this.textComponent.textFill.color = new vec4(0.55, 0.95, 0.95, 0.85)
    } else {
      this.textComponent.textFill.color = new vec4(1, 1, 1, 1)
    }
  }

  private getDisplayText(): string {
    if (!this.minimized) {
      return this.noteText
    }

    const trimmed = this.noteText.trim()
    if (trimmed.length > 0) {
      const firstLine = trimmed.split("\n")[0]
      return firstLine.length > 18 ? `${firstLine.substring(0, 17)}...` : firstLine
    }

    if (this.circuitStep) {
      return `Step ${this.circuitStep.stepIndex + 1}`
    }

    return "Note"
  }

  private getMinimizedButtonLabel(): string {
    if (this.circuitStep) {
      return `Step ${this.circuitStep.stepIndex + 1}`
    }
    return "Note"
  }

  private getResponsiveTextSize(): number {
    const length = this.noteText.trim().length
    if (length <= 10) return 56
    if (length <= 28) return 46
    if (length <= 75) return 38
    if (length <= 150) return 30
    if (length <= 260) return 25
    return 21
  }

  private estimateLineCount(text: string, approxCharsPerLine: number): number {
    if (text.length === 0) return 1

    let lines = 0
    const split = text.split("\n")
    for (const line of split) {
      lines += Math.max(1, Math.ceil(line.length / approxCharsPerLine))
    }
    return lines
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value))
  }
}
