import {TextInputField} from "SpectaclesUIKit.lspkg/Scripts/Components/TextInputField/TextInputField"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {WidgetBase} from "../WidgetBase"
import {CircuitStepMeta} from "../../Circuits/CircuitTypes"

interface NoteData {
  text: string
  circuit?: CircuitStepMeta
}

const NOTE_MIN_SIZE = new vec2(15, 9.5)
const NOTE_MAX_SIZE = new vec2(32, 26)

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

  onAwake(): void {
    super.onAwake()
    this.logger = new Logger(
      "NoteWidget",
      this.enableLogging || this.enableLoggingLifecycle,
      true
    )

    if (this.textComponent) {
      this.textComponent.text = this.noteText
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
          this.textComponent.text = text
        }
        this.applyResponsiveLayout()
        this.emitContentChange()
      })

      this.logger.debug("TextInputField bound")
    }
  }

  get serializedContent(): string {
    const data: NoteData = {text: this.noteText}
    if (this.circuitStep) {
      data.circuit = this.circuitStep
    }
    return JSON.stringify(data)
  }

  set serializedContent(value: string) {
    try {
      const data: NoteData = JSON.parse(value)
      this.noteText = data.text ?? ""
      this.circuitStep = data.circuit ?? null
      if (this.textComponent) {
        this.textComponent.text = this.noteText
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
      this.textComponent.text = text
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
    this.emitContentChange()
  }

  applyCompactLayout(): void {
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
    const halfW = frameSize.x * 0.5
    const halfH = frameSize.y * 0.5
    this.textComponent.size = this.getResponsiveTextSize()
    this.textComponent.worldSpaceRect = Rect.create(
      -halfW + 1.15,
      halfW - 1.15,
      -halfH + 1.15,
      halfH - 4.6
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
    const inputWidth = Math.max(13, frameSize.x - 3)
    this.inputField.size = new vec3(inputWidth, 3.1, 1)
    this.inputField.placeholderText = ""
    this.inputField.fontSize = 24

    if (this.inputFieldObject) {
      this.inputFieldObject.getTransform().setLocalPosition(
        new vec3(0, frameSize.y * 0.5 - 2.1, 0.12)
      )
    }
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
