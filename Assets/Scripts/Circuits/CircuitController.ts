import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {StorageController} from "../Storage/StorageController"
import {WidgetController} from "../Widgets/WidgetController"
import {WidgetType} from "../Widgets/WidgetTypes"
import {WidgetBase} from "../Widgets/WidgetBase"
import {NoteWidget} from "../Widgets/Types/NoteWidget"
import {
  CircuitDefinition,
  CircuitStepMeta,
  DEFAULT_CIRCUITS,
  circuitDataToVec3,
  vec3ToCircuitData,
} from "./CircuitTypes"
import {CircuitPathVisualizer} from "./CircuitPathVisualizer"
import {VoiceNoteController} from "../Audio/VoiceNoteController"

const STEP_TRIGGER_RADIUS_CM = 85
const STEP_HOLD_SECONDS = 1.1
const STATUS_UPDATE_INTERVAL_MS = 900
const FRAME_GUIDE_VERTICAL_OFFSET_CM = 2.4
const FRAME_GUIDE_BORDER_OUTSET_CM = 0.8
const FRAME_GUIDE_CORNER_OUTSET_CM = 1.2
const FRAME_GUIDE_MIN_CORNER_BIAS_CM = 0.5
const FRAME_GUIDE_PIN_FRONT_OFFSET_CM = 2.4
const FOLLOW_FINISH_AFTER_VOICE_DELAY_MS = 350

interface CircuitStepRuntime {
  widget: NoteWidget
  target: SceneObject
  meta: CircuitStepMeta
  text: string
}

export class CircuitController {
  private widgetController: WidgetController
  private storageController: StorageController
  private camera: Camera
  private widgetParent: SceneObject
  private logger: Logger
  private statusCallback: (text: string) => void

  private activeCircuitIndex: number = 0
  private followActive: boolean = false
  private createModeActive: boolean = false
  private currentCreateStepWidgetIndex: number = -1
  private revealedCreateNoteWidgetIndex: number = -1
  private nextStepIndex: number = 0
  private lastStatusAt: number = 0
  private enteredStepAt: number = -1
  private currentAreaName: string | null = null
  private pathVisualizer: CircuitPathVisualizer
  private voiceNoteController: VoiceNoteController | null = null
  private voiceGuideStepWidgetIndex: number = -1
  private pendingVoiceGuideFinishedWidgetIndex: number = -1
  private pendingFollowFinishMessage: string | null = null
  private pendingFollowFinishAtMs: number = 0
  private playedVoiceStepWidgetIndices: Set<number> = new Set()

  constructor(
    widgetController: WidgetController,
    storageController: StorageController,
    camera: Camera,
    widgetParent: SceneObject,
    logger: Logger,
    statusCallback: (text: string) => void,
    voiceNoteController?: VoiceNoteController
  ) {
    this.widgetController = widgetController
    this.storageController = storageController
    this.camera = camera
    this.widgetParent = widgetParent
    this.logger = logger
    this.statusCallback = statusCallback
    this.pathVisualizer = new CircuitPathVisualizer(widgetParent, logger)
    this.voiceNoteController = voiceNoteController ?? null
  }

  setArea(areaName: string | null): void {
    this.currentAreaName = areaName
    this.activeCircuitIndex = 0
    this.followActive = false
    this.createModeActive = false
    this.currentCreateStepWidgetIndex = -1
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.lastStatusAt = 0
    this.pendingFollowFinishMessage = null
    this.pendingFollowFinishAtMs = 0
    this.resetVoiceGuideState()
    this.clearGuide()
    this.applyActiveCircuitVisibility()
  }

  getActiveCircuit(): CircuitDefinition {
    return DEFAULT_CIRCUITS[this.activeCircuitIndex]
  }

  getActiveCircuitName(): string {
    return this.getActiveCircuit().name
  }

  getActiveCircuitIndex(): number {
    return this.activeCircuitIndex
  }

  getActiveCircuitStepCount(): number {
    return this.getStepsForCircuit(this.getActiveCircuit().id).length
  }

  getCircuitStepCounts(): number[] {
    return DEFAULT_CIRCUITS.map((circuit) =>
      this.getStepCountForCircuit(circuit.id)
    )
  }

  hasStepsForCircuit(circuitId: string): boolean {
    return this.getStepCountForCircuit(circuitId) > 0
  }

  getStepCountForCircuit(circuitId: string): number {
    return this.getStepsForCircuit(circuitId).length
  }

  isFollowing(): boolean {
    return this.followActive
  }

  isCreateModeActive(): boolean {
    return this.createModeActive
  }

  getCurrentVoiceNoteTarget(): NoteWidget | null {
    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) return null

    if (
      this.followActive &&
      this.nextStepIndex >= 0 &&
      this.nextStepIndex < steps.length
    ) {
      return steps[this.nextStepIndex].widget
    }

    if (this.currentCreateStepWidgetIndex >= 0) {
      const current = steps.find(
        (step) => step.widget.widgetIndex === this.currentCreateStepWidgetIndex
      )
      if (current) return current.widget
    }

    return steps[steps.length - 1].widget
  }

  setCreateModeActive(active: boolean): void {
    this.createModeActive = active
    this.pendingFollowFinishMessage = null
    this.pendingFollowFinishAtMs = 0
    if (!active) {
      this.currentCreateStepWidgetIndex = -1
      this.revealedCreateNoteWidgetIndex = -1
    }
    if (active) {
      this.followActive = false
      this.nextStepIndex = 0
      this.enteredStepAt = -1
      this.lastStatusAt = 0
      this.resetVoiceGuideState()
      this.clearGuide()
      if (this.currentCreateStepWidgetIndex < 0) {
        const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
        const latest = steps.length > 0 ? steps[steps.length - 1] : null
        if (latest) {
          this.currentCreateStepWidgetIndex = latest.widget.widgetIndex
        }
      }
    }
    this.applyActiveCircuitVisibility()
  }

  getActiveCircuitSummary(): string {
    const activeSteps = this.getStepsForCircuit(this.getActiveCircuit().id)
    const total = activeSteps.length

    if (this.createModeActive) {
      if (total === 0) {
        return `Editing · Step 0/0\nNo steps yet. Tap Create to add Step 1.`
      }

      const selectedIndex = this.getSelectedCreateStepOrdinal(activeSteps)
      const current = selectedIndex >= 0 ? selectedIndex + 1 : total
      return `Editing · Step ${current}/${total}\nMove the frame, edit the note, remove this step, or continue.`
    }

    if (total === 0) {
      return `Authoring · Step 0/0\nNo steps yet. Tap Create to add Step 1.`
    }

    if (this.followActive) {
      const current = Math.min(this.nextStepIndex + 1, total)
      if (this.nextStepIndex >= 0 && this.nextStepIndex < total) {
        const currentStep = activeSteps[this.nextStepIndex]
        if (this.isVoiceGuidePlayingForStep(currentStep)) {
          return (
            `Following · Step ${current}/${total}\n` +
            `Voice guide playing · ${this.voiceNoteController?.getPlaybackRemainingSeconds().toFixed(1) ?? "0.0"}s left.`
          )
        }
        const userPos = this.getCameraLocalPosition()
        const stepPos = this.getStepFollowPosition(currentStep)
        const distance = userPos.distance(stepPos)
        return `Following · Step ${current}/${total}\n${this.formatDistance(distance)} away. ${this.describeDirection(userPos, stepPos)}`
      }
      return `Following · Step ${current}/${total}\nWalk to the highlighted stop, or tap Next.`
    }

    const pendingBox = this.getLatestStepMissingObjectFrame(activeSteps)
    if (pendingBox) {
      const stepNumber = pendingBox.meta.stepIndex + 1
      return `Authoring · Step ${stepNumber}/${total}\nPlace a box for Step ${stepNumber} before adding another step.`
    }

    return `Authoring · Step ${total}/${total}\nTap Follow to walk it, or Create to add Step ${total + 1}.`
  }

  nextCircuit(): string {
    return this.selectCircuit((this.activeCircuitIndex + 1) % DEFAULT_CIRCUITS.length)
  }

  selectCircuit(index: number): string {
    if (index < 0 || index >= DEFAULT_CIRCUITS.length) {
      this.logger.warn(`Ignoring invalid circuit index: ${index}`)
      return this.getActiveCircuitName()
    }

    this.activeCircuitIndex = index
    this.followActive = false
    this.createModeActive = false
    this.currentCreateStepWidgetIndex = -1
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.lastStatusAt = 0
    this.pendingFollowFinishMessage = null
    this.pendingFollowFinishAtMs = 0
    this.resetVoiceGuideState()
    this.clearGuide()
    this.applyActiveCircuitVisibility()
    const stepCount = this.getActiveCircuitStepCount()
    this.statusCallback(
      stepCount > 0
        ? `${this.getActiveCircuitName()} selected.\nTap Follow to walk Step 1/${stepCount}, or Create to add another step.`
        : `${this.getActiveCircuitName()} selected.\nNo steps yet. Tap Create to add Step 1.`
    )
    return this.getActiveCircuitName()
  }

  selectBestAvailableCircuit(preferredIndex: number | null): string {
    const counts = this.getCircuitStepCounts()
    const preferredIsValid =
      preferredIndex !== null &&
      preferredIndex >= 0 &&
      preferredIndex < DEFAULT_CIRCUITS.length

    let targetIndex = preferredIsValid ? preferredIndex : -1
    if (targetIndex >= 0 && counts[targetIndex] === 0) {
      targetIndex = -1
    }

    if (targetIndex < 0) {
      targetIndex = counts.findIndex((count) => count > 0)
    }

    if (targetIndex < 0) {
      targetIndex = preferredIsValid ? preferredIndex : 0
    }

    this.activeCircuitIndex = Math.max(0, Math.min(DEFAULT_CIRCUITS.length - 1, targetIndex))
    this.followActive = false
    this.createModeActive = false
    this.currentCreateStepWidgetIndex = -1
    this.revealedCreateNoteWidgetIndex = -1
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.lastStatusAt = 0
    this.resetVoiceGuideState()
    this.clearGuide()
    this.applyActiveCircuitVisibility()
    return this.getActiveCircuitName()
  }

  addStep(areaName: string): boolean {
    const circuit = this.getActiveCircuit()
    const activeSteps = this.getStepsForCircuit(circuit.id)
    const pendingBoxStep = this.getLatestStepMissingObjectFrame(activeSteps)
    if (pendingBoxStep) {
      const stepNumber = pendingBoxStep.meta.stepIndex + 1
      this.statusCallback(
        `Step ${stepNumber} still needs a box.\nPlace the box before adding Step ${stepNumber + 1}.`
      )
      return false
    }
    this.revealedCreateNoteWidgetIndex = -1
    const routeSteps = this.getRouteSteps()
    const stepIndex = this.findFirstMissingStepIndex(
      activeSteps,
      routeSteps.length
    )
    const routeStep = routeSteps.find((step) => step.meta.stepIndex === stepIndex)

    const widget = this.widgetController.spawnWidget(
      WidgetType.Note,
      this.storageController,
      areaName
    ) as NoteWidget | null
    if (!widget) {
      this.statusCallback("Could not create a circuit step note.")
      return false
    }

    const target = this.widgetController.getTransformTargetForWidget(widget)
    if (!target) {
      this.statusCallback("Step note created, but its frame was not available.")
      return false
    }

    let triggerPosition = target.getTransform().getLocalPosition()
    if (routeStep) {
      triggerPosition = this.getStepFollowPosition(routeStep)
      const noteOffsetY = Math.max(
        6,
        (routeStep.widget.getObjectFrameData()?.size.y ?? 0) * 0.5 + 3.5
      )
      target
        .getTransform()
        .setLocalPosition(triggerPosition.add(new vec3(0, noteOffsetY, 0)))
      target
        .getTransform()
        .setLocalRotation(routeStep.target.getTransform().getLocalRotation())
    }

    const meta: CircuitStepMeta = {
      circuitId: circuit.id,
      circuitName: circuit.name,
      stepIndex,
      triggerPosition: vec3ToCircuitData(triggerPosition),
      authoredAt: Date.now(),
      authorLabel: circuit.authorLabel,
    }

    widget.serializedContent = JSON.stringify({
      text: "",
      circuit: meta,
    })
    this.widgetController.refreshWidgetLayout(widget)

    // New authoring flow: each step starts as a placed box + optional note.
    // Create the box immediately so users can position it first.
    this.widgetController.toggleObjectFrameForNote(
      widget,
      this.storageController,
      areaName
    )
    this.currentCreateStepWidgetIndex = widget.widgetIndex

    this.widgetController.saveAllWidgets(this.storageController, areaName)
    this.applyActiveCircuitVisibility()
    if (this.followActive) {
      this.updateGuide()
    }
    this.statusCallback(
      routeStep
        ? `Step ${stepIndex + 1} is ready in ${circuit.name}.\nPlace the box, then tap Next Step or Finish.`
        : `Added Step ${stepIndex + 1} to ${circuit.name}.\n` +
            "Place the box first, then tap Next Step or Finish."
    )
    return true
  }

  startEditingActiveCircuit(): boolean {
    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps yet.\nTap Create to add Step 1.`
      )
      return false
    }

    this.followActive = false
    this.createModeActive = true
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.lastStatusAt = 0
    this.resetVoiceGuideState()
    this.clearGuide()
    this.selectCreateStep(steps[0], true)
    this.applyActiveCircuitVisibility()
    this.statusCallback(
      `Editing ${this.getActiveCircuitName()} step 1/${steps.length}.\nUse Prev/Next Step to move through the story.`
    )
    return true
  }

  selectPreviousCreateStep(): boolean {
    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps yet.\nTap Create to add Step 1.`
      )
      return false
    }

    const currentIndex = this.getSelectedCreateStepOrdinal(steps)
    const nextIndex =
      currentIndex <= 0 ? steps.length - 1 : currentIndex - 1
    this.selectCreateStep(steps[nextIndex], true)
    this.applyActiveCircuitVisibility()
    this.statusCallback(
      `Editing step ${nextIndex + 1}/${steps.length}.\nMove the frame or edit the note.`
    )
    return true
  }

  advanceCreateStepOrAdd(areaName: string): boolean {
    if (!this.createModeActive) {
      return this.addStep(areaName)
    }

    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      return this.addStep(areaName)
    }

    const currentIndex = this.getSelectedCreateStepOrdinal(steps)
    if (currentIndex >= 0 && currentIndex < steps.length - 1) {
      const nextIndex = currentIndex + 1
      this.selectCreateStep(steps[nextIndex], true)
      this.applyActiveCircuitVisibility()
      this.statusCallback(
        `Editing step ${nextIndex + 1}/${steps.length}.\nMove the frame or edit the note.`
      )
      return true
    }

    return this.addStep(areaName)
  }

  removeCurrentStep(areaName: string): boolean {
    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps to remove.`
      )
      return false
    }

    const selectedStep = this.getSelectedCreateStep(steps) ?? steps[steps.length - 1]
    const removedStepIndex = selectedStep.meta.stepIndex
    const removedStepNumber = removedStepIndex + 1
    if (this.voiceNoteController?.isRecording()) {
      this.voiceNoteController.stopRecording()
    }
    const removedVoice = selectedStep.widget.getVoiceNoteData()
    if (removedVoice) {
      this.storageController.deleteVoiceNote(areaName, removedVoice.id)
      selectedStep.widget.setVoiceNoteData(null, false)
    }
    this.stopVoiceGuide(false)
    if (!this.widgetController.removeWidgetByIndex(
      selectedStep.widget.widgetIndex,
      this.storageController,
      areaName
    )) {
      this.statusCallback("Could not remove this step.")
      return false
    }

    this.renumberCircuitSteps(areaName)
    const remainingSteps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (remainingSteps.length === 0) {
      this.createModeActive = false
      this.currentCreateStepWidgetIndex = -1
      this.revealedCreateNoteWidgetIndex = -1
      this.nextStepIndex = 0
      this.enteredStepAt = -1
      this.clearGuide()
      this.applyActiveCircuitVisibility()
      this.statusCallback(
        `Removed step ${removedStepNumber}.\n${this.getActiveCircuitName()} has no steps left.`
      )
      return true
    }

    const nextIndex = Math.min(removedStepIndex, remainingSteps.length - 1)
    this.selectCreateStep(remainingSteps[nextIndex], true)
    this.applyActiveCircuitVisibility()
    this.statusCallback(
      `Removed step ${removedStepNumber}.\nNow editing step ${nextIndex + 1}/${remainingSteps.length}.`
    )
    return true
  }

  toggleFollow(): boolean {
    if (this.followActive) {
      this.stopFollow()
      this.statusCallback(`Stopped following ${this.getActiveCircuitName()}.`)
      return false
    }

    const stepCount = this.getActiveCircuitStepCount()
    if (stepCount === 0) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps yet.\n` +
          "Tap Create to add Step 1."
      )
      return false
    }

    this.startFollowForCurrentCircuit(stepCount, false)
    return true
  }

  stopFollow(): void {
    this.followActive = false
    this.currentCreateStepWidgetIndex = -1
    this.revealedCreateNoteWidgetIndex = -1
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.pendingFollowFinishMessage = null
    this.pendingFollowFinishAtMs = 0
    this.resetVoiceGuideState()
    this.clearGuide()
    this.applyActiveCircuitVisibility()
  }

  advanceFollowStep(): boolean {
    if (!this.followActive) {
      this.statusCallback("Tap Follow to start walking the selected story from Step 1.")
      return false
    }

    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.finishFollow(`${this.getActiveCircuitName()} has no steps.`)
      return true
    }

    if (this.nextStepIndex >= steps.length) {
      this.finishFollow(
        `${this.getActiveCircuitName()} complete.\nAuthoring mode is active again.`
      )
      return true
    }

    this.stopVoiceGuide(false)
    this.advanceFromCurrentStep(steps, "manual")
    return true
  }

  toggleObjectFrameForCurrentStep(areaName: string): boolean {
    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps yet.\nTap Create to add Step 1 first.`
      )
      return false
    }

    const step = this.getObjectFrameTargetStep(steps)
    const enabled = this.widgetController.toggleObjectFrameForNote(
      step.widget,
      this.storageController,
      areaName
    )
    this.applyActiveCircuitVisibility()
    this.statusCallback(
      enabled
        ? `Box added to step ${step.meta.stepIndex + 1}.\nMove and resize the outline around the real object.`
        : `Box removed from step ${step.meta.stepIndex + 1}.`
    )
    return true
  }

  revealLatestStepNoteAboveBox(): boolean {
    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps yet.\nTap Create to add Step 1 first.`
      )
      return false
    }

    const step = this.getSelectedCreateStep(steps) ?? steps[steps.length - 1]
    const frameData = step.widget.getObjectFrameData()
    if (!frameData || frameData.enabled !== true) {
      this.statusCallback(
        `Step ${step.meta.stepIndex + 1} has no box yet.\nPlace the box first, then add note.`
      )
      return false
    }

    if (!this.positionStepNoteAboveFrame(step)) {
      this.statusCallback("Could not open note: note panel transform is missing.")
      return false
    }

    this.currentCreateStepWidgetIndex = step.widget.widgetIndex
    this.revealedCreateNoteWidgetIndex = step.widget.widgetIndex
    this.applyActiveCircuitVisibility()
    this.statusCallback(
      `Note opened above Step ${step.meta.stepIndex + 1}.\nWrite your note, then tap Next Step or Finish.`
    )
    return true
  }

  toggleVoiceRecordingForCurrentStep(areaName: string): boolean {
    if (!this.voiceNoteController) {
      this.statusCallback("Voice recording is not available yet.")
      return false
    }

    const stepNote = this.getCurrentVoiceNoteTarget()
    if (!stepNote) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps yet.\nTap Create to add Step 1 first.`
      )
      return false
    }

    const result = this.voiceNoteController.toggleRecording(stepNote, areaName)
    if (result.success) {
      this.widgetController.saveAllWidgets(this.storageController, areaName)
    }
    this.statusCallback(result.message)
    return result.success
  }

  update(): boolean {
    if (!this.followActive) {
      this.pendingVoiceGuideFinishedWidgetIndex = -1
      this.pendingFollowFinishMessage = null
      this.pendingFollowFinishAtMs = 0
      return false
    }

    const now = Date.now()

    if (this.pendingFollowFinishMessage) {
      if (now >= this.pendingFollowFinishAtMs) {
        const message = this.pendingFollowFinishMessage
        this.pendingFollowFinishMessage = null
        this.pendingFollowFinishAtMs = 0
        this.finishFollow(message)
        return true
      }
      return false
    }

    if (this.pendingVoiceGuideFinishedWidgetIndex >= 0) {
      const finishedWidgetIndex = this.pendingVoiceGuideFinishedWidgetIndex
      this.pendingVoiceGuideFinishedWidgetIndex = -1
      this.onVoiceGuideFinished(finishedWidgetIndex)
      return true
    }

    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.finishFollow(`${this.getActiveCircuitName()} has no steps.`)
      return true
    }

    if (this.nextStepIndex >= steps.length) {
      this.finishFollow(
        `${this.getActiveCircuitName()} complete.\nAuthoring mode is active again.`
      )
      return true
    }

    const currentStep = steps[this.nextStepIndex]
    const userPos = this.getCameraLocalPosition()
    const stepPos = this.getStepFollowPosition(currentStep)
    const distance = userPos.distance(stepPos)

    if (this.isVoiceGuidePlayingForStep(currentStep)) {
      if (now - this.lastStatusAt >= STATUS_UPDATE_INTERVAL_MS) {
        this.lastStatusAt = now
        this.statusCallback(
          `Listening at step ${this.nextStepIndex + 1}/${steps.length}.\n` +
            `Next stop appears when the guide finishes.`
        )
        return true
      }
      return false
    }

    if (distance <= STEP_TRIGGER_RADIUS_CM) {
      if (this.tryStartVoiceGuide(currentStep, steps.length)) {
        this.lastStatusAt = now
        return true
      }

      if (this.enteredStepAt < 0) {
        this.enteredStepAt = now
        const voiceError =
          currentStep.widget.hasVoiceNote()
            ? this.voiceNoteController?.getLastPlaybackError() ?? ""
            : ""
        this.statusCallback(
          `At step ${this.nextStepIndex + 1}/${steps.length}.\n` +
            (currentStep.widget.hasVoiceNote()
              ? `${voiceError !== "" ? voiceError + " " : ""}Hold here to collect this stop.`
              : "Hold here to collect this stop.")
        )
        this.updateGuide(steps)
        this.lastStatusAt = now
        return true
      }

      const heldFor = (now - this.enteredStepAt) / 1000
      if (heldFor < STEP_HOLD_SECONDS) {
        if (now - this.lastStatusAt >= STATUS_UPDATE_INTERVAL_MS) {
          this.statusCallback(
            `Hold at step ${this.nextStepIndex + 1}/${steps.length}.\n${Math.max(0.1, STEP_HOLD_SECONDS - heldFor).toFixed(1)}s left.`
          )
          this.lastStatusAt = now
          return true
        }
        return false
      }

      this.advanceFromCurrentStep(steps, "hold")
      this.lastStatusAt = now
      return true
    }

    this.enteredStepAt = -1
    if (now - this.lastStatusAt < STATUS_UPDATE_INTERVAL_MS) return false
    this.lastStatusAt = now
    this.updateGuide(steps)

    this.statusCallback(
      `Go to step ${this.nextStepIndex + 1}/${steps.length}: ${this.getStepLabel(currentStep)}.\n` +
        `${this.formatDistance(distance)} away. ${this.describeDirection(userPos, stepPos)}`
    )
    return true
  }

  applyActiveCircuitVisibility(): void {
    const activeId = this.getActiveCircuit().id
    const activeSteps = this.followActive ? this.getStepsForCircuit(activeId) : []
    const visibleFollowTargets = new Set<SceneObject>()
    if (this.followActive) {
      const maxVisibleIndex = Math.min(this.nextStepIndex, activeSteps.length - 1)
      for (let i = 0; i <= maxVisibleIndex; i++) {
        visibleFollowTargets.add(activeSteps[i].target)
      }
    }

    for (const widget of this.widgetController.getWidgets()) {
      const target = this.widgetController.getTransformTargetForWidget(widget)
      if (!target) continue

      const note = this.asCircuitNote(widget)
      if (!note) {
        target.enabled = true
        this.widgetController.setWidgetAuxiliaryVisibility(widget, true)
        continue
      }

      const meta = note.getCircuitStep()
      const lockForFollow = !!meta && this.followActive && meta.circuitId === activeId
      this.widgetController.setWidgetTransformInteractive(note, !lockForFollow)
      this.widgetController.setObjectFrameInteractiveForNote(note, !lockForFollow)
      this.widgetController.setNoteEditingEnabled(
        note,
        !lockForFollow &&
          (!this.createModeActive ||
            note.widgetIndex === this.revealedCreateNoteWidgetIndex)
      )

      if (!meta) {
        target.enabled = true
        this.widgetController.setWidgetAuxiliaryVisibility(widget, true)
      } else if (meta.circuitId !== activeId) {
        target.enabled = false
        this.widgetController.setWidgetAuxiliaryVisibility(widget, false)
      } else if (!this.followActive) {
        if (this.createModeActive) {
          const isCurrentCreateStep = note.widgetIndex === this.currentCreateStepWidgetIndex
          target.enabled =
            isCurrentCreateStep &&
            note.widgetIndex === this.revealedCreateNoteWidgetIndex
          this.widgetController.setWidgetAuxiliaryVisibility(widget, isCurrentCreateStep)
        } else {
          target.enabled = false
          this.widgetController.setWidgetAuxiliaryVisibility(widget, false)
        }
      } else {
        const visible = visibleFollowTargets.has(target)
        target.enabled = visible && this.stepHasVisibleNote(note)
        this.widgetController.setWidgetAuxiliaryVisibility(widget, visible)
      }
    }

    if (this.followActive) {
      this.updateGuide(activeSteps)
    }
  }

  private getStepsForCircuit(circuitId: string): CircuitStepRuntime[] {
    return this.getAllCircuitSteps()
      .filter((step) => step.meta.circuitId === circuitId)
      .sort((a, b) => a.meta.stepIndex - b.meta.stepIndex)
  }

  private getRouteSteps(): CircuitStepRuntime[] {
    const byIndex = new Map<number, CircuitStepRuntime>()
    for (const step of this.getAllCircuitSteps()) {
      if (!byIndex.has(step.meta.stepIndex)) {
        byIndex.set(step.meta.stepIndex, step)
      }
    }
    return Array.from(byIndex.values()).sort(
      (a, b) => a.meta.stepIndex - b.meta.stepIndex
    )
  }

  private getAllCircuitSteps(): CircuitStepRuntime[] {
    const steps: CircuitStepRuntime[] = []
    for (const widget of this.widgetController.getWidgets()) {
      const note = this.asCircuitNote(widget)
      if (!note) continue

      const meta = note.getCircuitStep()
      if (!meta) continue

      const target = this.widgetController.getTransformTargetForWidget(widget)
      if (!target) continue

      steps.push({
        widget: note,
        target,
        meta,
        text: note.getText(),
      })
    }
    return steps
  }

  private getSelectedCreateStep(
    steps: CircuitStepRuntime[]
  ): CircuitStepRuntime | null {
    if (this.currentCreateStepWidgetIndex < 0) return null
    return (
      steps.find(
        (step) => step.widget.widgetIndex === this.currentCreateStepWidgetIndex
      ) ?? null
    )
  }

  private getSelectedCreateStepOrdinal(steps: CircuitStepRuntime[]): number {
    if (this.currentCreateStepWidgetIndex < 0) return -1
    return steps.findIndex(
      (step) => step.widget.widgetIndex === this.currentCreateStepWidgetIndex
    )
  }

  private selectCreateStep(step: CircuitStepRuntime, revealNote: boolean): void {
    if (
      this.voiceNoteController?.isRecording() === true &&
      this.currentCreateStepWidgetIndex !== step.widget.widgetIndex
    ) {
      this.voiceNoteController.stopRecording()
    }
    this.stopVoiceGuide(false)
    this.currentCreateStepWidgetIndex = step.widget.widgetIndex
    if (revealNote) {
      this.revealedCreateNoteWidgetIndex = step.widget.widgetIndex
      this.positionStepNoteAboveFrame(step)
    } else if (this.revealedCreateNoteWidgetIndex !== step.widget.widgetIndex) {
      this.revealedCreateNoteWidgetIndex = -1
    }
  }

  private renumberCircuitSteps(areaName: string): void {
    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      if (step.meta.stepIndex === i) continue

      step.widget.setCircuitStep({
        ...step.meta,
        stepIndex: i,
      })
      this.widgetController.refreshWidgetLayout(step.widget)
    }
    this.widgetController.saveAllWidgets(this.storageController, areaName)
  }

  private getObjectFrameTargetStep(
    steps: CircuitStepRuntime[]
  ): CircuitStepRuntime {
    if (this.createModeActive) {
      const selectedStep = this.getSelectedCreateStep(steps)
      if (selectedStep) return selectedStep
    }

    if (
      this.followActive &&
      this.nextStepIndex >= 0 &&
      this.nextStepIndex < steps.length
    ) {
      return steps[this.nextStepIndex]
    }

    return steps[steps.length - 1]
  }

  private getLatestStepMissingObjectFrame(
    steps: CircuitStepRuntime[]
  ): CircuitStepRuntime | null {
    if (steps.length === 0) return null
    const latestStep = steps[steps.length - 1]
    const frameData = latestStep.widget.getObjectFrameData()
    if (!frameData || frameData.enabled !== true) {
      return latestStep
    }
    return null
  }

  private findFirstMissingStepIndex(
    activeSteps: CircuitStepRuntime[],
    routeStepCount: number
  ): number {
    const activeIndices = new Set<number>(
      activeSteps.map((step) => step.meta.stepIndex)
    )
    for (let i = 0; i < routeStepCount; i++) {
      if (!activeIndices.has(i)) {
        return i
      }
    }
    return routeStepCount
  }

  private asCircuitNote(widget: WidgetBase): NoteWidget | null {
    if (widget.widgetType !== WidgetType.Note) return null
    const maybeNote = widget as NoteWidget
    if (typeof maybeNote.getCircuitStep !== "function") return null
    return maybeNote
  }

  private updateGuide(steps?: CircuitStepRuntime[]): void {
    const activeSteps = steps ?? this.getStepsForCircuit(this.getActiveCircuit().id)
    const userPosition = this.followActive ? this.getCameraLocalPosition() : undefined
    let directionHint: string | undefined = undefined
    if (
      userPosition &&
      this.nextStepIndex >= 0 &&
      this.nextStepIndex < activeSteps.length
    ) {
      directionHint = this.describeDirection(
        userPosition,
        this.getStepFollowPosition(activeSteps[this.nextStepIndex])
      )
    }

    this.pathVisualizer.render(
      activeSteps.map((step, index) => {
        const layout = this.getStepGuideLayout(
          step,
          this.getGuideNeighborPosition(activeSteps, index)
        )
        return {
          target: step.target,
          meta: step.meta,
          guidePosition: layout.guidePosition,
          pinCenter: layout.pinCenter,
          pinRotation: layout.pinRotation,
        }
      }),
      this.nextStepIndex,
      userPosition,
      directionHint
    )

    const activeGuideStates = new Map<number, "upcoming" | "active" | "visited">()
    for (let i = 0; i < activeSteps.length; i++) {
      activeGuideStates.set(
        activeSteps[i].widget.widgetIndex,
        i === this.nextStepIndex
          ? "active"
          : i < this.nextStepIndex
            ? "visited"
            : "upcoming"
      )
    }

    for (const step of this.getAllCircuitSteps()) {
      if (step.meta.circuitId !== this.getActiveCircuit().id) {
        step.widget.setGuideState("none")
        continue
      }

      step.widget.setGuideState(activeGuideStates.get(step.widget.widgetIndex) ?? "upcoming")
    }
  }

  private clearGuide(): void {
    this.pathVisualizer?.clear()
    for (const widget of this.widgetController.getWidgets()) {
      const note = this.asCircuitNote(widget)
      if (note) {
        note.setGuideState("none")
      }
    }
  }

  private tryStartVoiceGuide(step: CircuitStepRuntime, totalSteps: number): boolean {
    if (!this.voiceNoteController || !this.currentAreaName) return false
    if (this.playedVoiceStepWidgetIndices.has(step.widget.widgetIndex)) return false
    if (!this.voiceNoteController.hasPlayableVoice(step.widget, this.currentAreaName)) {
      return false
    }

    const started = this.voiceNoteController.playVoiceForNote(
      step.widget,
      this.currentAreaName,
      () => this.queueVoiceGuideFinished(step.widget.widgetIndex)
    )
    if (!started) {
      const error = this.voiceNoteController.getLastPlaybackError()
      if (error !== "") {
        this.statusCallback(`${error}\nHold here to collect this stop instead.`)
      }
      return false
    }

    this.voiceGuideStepWidgetIndex = step.widget.widgetIndex
    this.enteredStepAt = -1
    this.updateGuide()
    this.statusCallback(
      `Voice guide playing for step ${this.nextStepIndex + 1}/${totalSteps}.\n` +
        "Stay nearby. The next stop appears when it finishes."
    )
    return true
  }

  private queueVoiceGuideFinished(widgetIndex: number): void {
    if (widgetIndex < 0) return
    this.pendingVoiceGuideFinishedWidgetIndex = widgetIndex
  }

  private onVoiceGuideFinished(widgetIndex: number): void {
    try {
      if (!this.followActive || widgetIndex !== this.voiceGuideStepWidgetIndex) {
        return
      }

      const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
      const finishedStepIndex = steps.findIndex(
        (step) => step.widget.widgetIndex === widgetIndex
      )
      if (finishedStepIndex < 0) {
        this.voiceGuideStepWidgetIndex = -1
        this.enteredStepAt = -1
        this.applyActiveCircuitVisibility()
        return
      }

      if (this.nextStepIndex !== finishedStepIndex) {
        if (finishedStepIndex < this.nextStepIndex) {
          this.voiceGuideStepWidgetIndex = -1
          return
        }
        this.nextStepIndex = finishedStepIndex
      }

      this.advanceFromCurrentStep(steps, "voice")
      this.lastStatusAt = Date.now()
    } catch (e) {
      this.logger.error(`Voice guide finish failed: ${e}`)
      this.voiceGuideStepWidgetIndex = -1
      this.enteredStepAt = -1
      this.applyActiveCircuitVisibility()
      this.statusCallback(
        "Voice guide finished, but the path state changed.\nTap Follow to continue."
      )
    }
  }

  private isVoiceGuidePlayingForStep(step: CircuitStepRuntime): boolean {
    return (
      this.voiceGuideStepWidgetIndex === step.widget.widgetIndex &&
      this.voiceNoteController?.isPlayingForNote(step.widget) === true
    )
  }

  private stopVoiceGuide(callFinished: boolean): void {
    this.voiceNoteController?.stopPlayback(callFinished)
    this.voiceGuideStepWidgetIndex = -1
    this.pendingVoiceGuideFinishedWidgetIndex = -1
  }

  private resetVoiceGuideState(): void {
    this.stopVoiceGuide(false)
    this.playedVoiceStepWidgetIndices.clear()
  }

  private getAdvanceSourceText(source: "hold" | "manual" | "voice"): string {
    if (source === "manual") return "Advanced manually."
    if (source === "voice") return "Voice guide finished."
    return "Collected."
  }

  private advanceFromCurrentStep(
    steps: CircuitStepRuntime[],
    source: "hold" | "manual" | "voice"
  ): void {
    if (this.nextStepIndex < 0 || this.nextStepIndex >= steps.length) {
      this.finishFollow(
        `${this.getActiveCircuitName()} complete.\nAuthoring mode is active again.`
      )
      return
    }

    const currentStep = steps[this.nextStepIndex]
    const reachedText = this.buildStepReachedText(currentStep, steps.length)

    this.playedVoiceStepWidgetIndices.add(currentStep.widget.widgetIndex)
    this.voiceGuideStepWidgetIndex = -1
    this.nextStepIndex++
    this.enteredStepAt = -1

    if (this.nextStepIndex >= steps.length) {
      const message = `${reachedText}\n${this.getAdvanceSourceText(source)}\nPath complete.`
      if (source === "voice") {
        this.queueFollowFinish(message)
      } else {
        this.finishFollow(message)
      }
      return
    }

    this.applyActiveCircuitVisibility()
    this.statusCallback(
      `${reachedText}\n${this.getAdvanceSourceText(source)}\n` +
        `Now showing step ${this.nextStepIndex + 1}/${steps.length}.`
    )
  }

  private queueFollowFinish(message: string): void {
    this.pendingFollowFinishMessage = message
    this.pendingFollowFinishAtMs = Date.now() + FOLLOW_FINISH_AFTER_VOICE_DELAY_MS
    // Keep the current guide stable while the audio output drains; finishFollow()
    // will clear and restore authoring visibility on the next queued update.
    this.statusCallback(message)
  }

  private finishFollow(message: string): void {
    this.followActive = false
    this.currentCreateStepWidgetIndex = -1
    this.revealedCreateNoteWidgetIndex = -1
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.pendingFollowFinishMessage = null
    this.pendingFollowFinishAtMs = 0
    this.stopVoiceGuide(false)
    this.playedVoiceStepWidgetIndices.clear()
    this.clearGuide()
    this.applyActiveCircuitVisibility()
    this.statusCallback(message)
  }

  private startFollowForCurrentCircuit(stepCount: number, _fromCircuitTap: boolean): void {
    this.followActive = true
    this.createModeActive = false
    this.currentCreateStepWidgetIndex = -1
    this.revealedCreateNoteWidgetIndex = -1
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.lastStatusAt = 0
    this.pendingFollowFinishMessage = null
    this.pendingFollowFinishAtMs = 0
    this.resetVoiceGuideState()
    this.applyActiveCircuitVisibility()
    this.statusCallback(
      stepCount < 2
        ? `${this.getActiveCircuitName()} follow started at Step 1/${stepCount}.\nWalk to the highlighted stop; voice plays when available.`
        : `Walkthrough started at Step 1/${stepCount}.\nFollow the yellow guide. Voice guides play when you arrive.`
    )
  }

  private getCameraLocalPosition(): vec3 {
    const camTransform = this.camera.getSceneObject().getTransform()
    const parentTransform = this.widgetParent.getTransform()
    const parentWorldPos = parentTransform.getWorldPosition()
    const parentWorldRot = parentTransform.getWorldRotation()
    const invParentRot = parentWorldRot.invert()
    return invParentRot.multiplyVec3(
      camTransform.getWorldPosition().sub(parentWorldPos)
    )
  }

  private buildStepReachedText(
    step: CircuitStepRuntime,
    totalSteps: number
  ): string {
    const nextLine =
      this.nextStepIndex + 1 >= totalSteps
        ? "Final step reached."
        : `Next: step ${this.nextStepIndex + 2}/${totalSteps}.`

    const noteText = step.text.trim()
    const circuitName = this.getCircuitDisplayName(step.meta.circuitId)
    return noteText.length > 0
      ? `${circuitName} step ${step.meta.stepIndex + 1}/${totalSteps}\n${noteText}\n${nextLine}`
      : `${circuitName} step ${step.meta.stepIndex + 1}/${totalSteps}\n${nextLine}`
  }

  private getCircuitDisplayName(circuitId: string): string {
    const circuit = DEFAULT_CIRCUITS.find((item) => item.id === circuitId)
    return circuit ? circuit.name : this.getActiveCircuitName()
  }

  private getStepFollowPosition(step: CircuitStepRuntime): vec3 {
    const frameData = step.widget.getObjectFrameData()
    if (frameData && frameData.enabled === true) {
      return circuitDataToVec3(frameData.position)
    }
    return step.target.getTransform().getLocalPosition()
  }

  private positionStepNoteAboveFrame(step: CircuitStepRuntime): boolean {
    const target = this.widgetController.getTransformTargetForWidget(step.widget)
    if (!target) return false

    const frameData = step.widget.getObjectFrameData()
    const yOffset = Math.max(
      6,
      frameData && frameData.enabled === true
        ? frameData.size.y * 0.5 + 3.5
        : 6
    )
    const notePos = this.getStepFollowPosition(step).add(new vec3(0, yOffset, 0))
    target.getTransform().setLocalPosition(notePos)
    return true
  }

  private getStepGuideLayout(
    step: CircuitStepRuntime,
    neighborPosition: vec3 | null
  ): {guidePosition: vec3; pinCenter?: vec3; pinRotation?: quat} {
    const frameData = step.widget.getObjectFrameData()
    if (!frameData || frameData.enabled !== true) {
      return {
        guidePosition: step.target.getTransform().getLocalPosition(),
      }
    }

    const center = circuitDataToVec3(frameData.position)
    const rotation = quat.fromEulerAngles(
      frameData.rotation.x,
      frameData.rotation.y,
      frameData.rotation.z
    )
    const cornerSign = this.getFrameCornerSign(center, rotation, neighborPosition)
    const borderCorner = center.add(
      rotation.multiplyVec3(
        new vec3(
          frameData.size.x * 0.5 * cornerSign,
          -frameData.size.y * 0.5,
          0
        )
      )
    )
    const bottomCorner = center.add(
      rotation.multiplyVec3(
        new vec3(
          (frameData.size.x * 0.5 + FRAME_GUIDE_CORNER_OUTSET_CM) * cornerSign,
          -frameData.size.y * 0.5,
          0
        )
      )
    )

    // CircuitPathVisualizer lifts guide points slightly; start below the edge so
    // the rendered connector lands on the bottom corner instead of the open center.
    return {
      guidePosition: bottomCorner.add(
        new vec3(0, -FRAME_GUIDE_VERTICAL_OFFSET_CM - FRAME_GUIDE_BORDER_OUTSET_CM, 0)
      ),
      pinCenter: borderCorner.add(
        rotation.multiplyVec3(
          new vec3(0, 0, FRAME_GUIDE_PIN_FRONT_OFFSET_CM)
        )
      ),
      pinRotation: rotation,
    }
  }

  private getGuideNeighborPosition(
    steps: CircuitStepRuntime[],
    index: number
  ): vec3 | null {
    if (index < steps.length - 1) {
      return this.getStepFollowPosition(steps[index + 1])
    }
    if (index > 0) {
      return this.getStepFollowPosition(steps[index - 1])
    }
    return null
  }

  private getFrameCornerSign(
    center: vec3,
    rotation: quat,
    neighborPosition: vec3 | null
  ): number {
    if (!neighborPosition) return 1

    const localDelta = rotation.invert().multiplyVec3(neighborPosition.sub(center))
    if (Math.abs(localDelta.x) < FRAME_GUIDE_MIN_CORNER_BIAS_CM) {
      return 1
    }
    return localDelta.x >= 0 ? 1 : -1
  }

  private getStepLabel(step: CircuitStepRuntime): string {
    const firstLine = step.text.trim().split("\n")[0]
    if (firstLine.length > 0) return firstLine
    return `Step ${step.meta.stepIndex + 1}`
  }

  private stepHasVisibleNote(note: NoteWidget): boolean {
    return note.getText().trim().length > 0
  }

  private describeDirection(userPos: vec3, stepPos: vec3): string {
    const toTarget = stepPos.sub(userPos)
    const flatTarget = new vec3(toTarget.x, 0, toTarget.z)
    if (flatTarget.length < 1) return "You are almost there."

    const camForward = this.getCameraLocalForward()
    const flatForward = new vec3(camForward.x, 0, camForward.z)
    if (flatForward.length < 0.001) return "Look for the yellow NEXT markers."

    const targetDir = flatTarget.normalize()
    const forwardDir = flatForward.normalize()
    const dot = Math.max(-1, Math.min(1, forwardDir.dot(targetDir)))
    const angle = Math.acos(dot) * 180 / Math.PI
    const turn = forwardDir.x * targetDir.z - forwardDir.z * targetDir.x

    if (angle < 25) return "Keep moving ahead."
    if (angle > 145) return "Turn around toward the guide."
    return turn > 0 ? "Turn right toward the guide." : "Turn left toward the guide."
  }

  private getCameraLocalForward(): vec3 {
    const camTransform = this.camera.getSceneObject().getTransform()
    const parentWorldRot = this.widgetParent.getTransform().getWorldRotation()
    const invParentRot = parentWorldRot.invert()
    const cameraForward = camTransform.getWorldRotation().multiplyVec3(new vec3(0, 0, -1))
    return invParentRot.multiplyVec3(cameraForward)
  }

  private formatDistance(distanceCm: number): string {
    if (distanceCm < 100) {
      return `${Math.round(distanceCm)} cm`
    }
    return `${(distanceCm / 100).toFixed(1)} m`
  }
}
