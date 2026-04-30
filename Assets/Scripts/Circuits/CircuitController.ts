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

const STEP_TRIGGER_RADIUS_CM = 85
const STEP_HOLD_SECONDS = 1.1
const STATUS_UPDATE_INTERVAL_MS = 900

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
  private nextStepIndex: number = 0
  private lastStatusAt: number = 0
  private enteredStepAt: number = -1
  private currentAreaName: string | null = null
  private pathVisualizer: CircuitPathVisualizer

  constructor(
    widgetController: WidgetController,
    storageController: StorageController,
    camera: Camera,
    widgetParent: SceneObject,
    logger: Logger,
    statusCallback: (text: string) => void
  ) {
    this.widgetController = widgetController
    this.storageController = storageController
    this.camera = camera
    this.widgetParent = widgetParent
    this.logger = logger
    this.statusCallback = statusCallback
    this.pathVisualizer = new CircuitPathVisualizer(widgetParent, logger)
  }

  setArea(areaName: string | null): void {
    this.currentAreaName = areaName
    this.activeCircuitIndex = 0
    this.followActive = false
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.lastStatusAt = 0
    this.clearGuide()
    this.applyActiveCircuitVisibility()
  }

  getActiveCircuit(): CircuitDefinition {
    return DEFAULT_CIRCUITS[this.activeCircuitIndex]
  }

  getActiveCircuitName(): string {
    return this.getActiveCircuit().name
  }

  isFollowing(): boolean {
    return this.followActive
  }

  getActiveCircuitSummary(): string {
    const activeSteps = this.getStepsForCircuit(this.getActiveCircuit().id)
    const routeSteps = this.getRouteSteps()
    const layerName = this.getActiveCircuitName()

    if (routeSteps.length === 0) {
      return `${layerName} layer: no route points yet.\nStep + marks the first stop in this area.`
    }

    const countText = `${activeSteps.length}/${routeSteps.length}`
    const followText = this.followActive
      ? activeSteps.length < 2
        ? "Add one more Step+ to create a walkable path."
        : `Following step ${Math.min(this.nextStepIndex + 1, activeSteps.length)}/${activeSteps.length}.`
      : "Follow Path draws the route and highlights the next stop."

    return `${layerName} layer: ${countText} stops on the shared route.\n${followText}`
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
    this.nextStepIndex = 0
    this.clearGuide()
    this.applyActiveCircuitVisibility()
    this.statusCallback(
      `Layer selected: ${this.getActiveCircuitName()}\n` +
        "Only notes from this layer are shown."
    )
    return this.getActiveCircuitName()
  }

  addStep(areaName: string): boolean {
    const circuit = this.getActiveCircuit()
    const activeSteps = this.getStepsForCircuit(circuit.id)
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
      target
        .getTransform()
        .setLocalPosition(routeStep.target.getTransform().getLocalPosition())
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

    this.widgetController.saveAllWidgets(this.storageController, areaName)
    this.applyActiveCircuitVisibility()
    if (this.followActive) {
      this.updateGuide()
    }
    this.statusCallback(
      routeStep
        ? `Added ${circuit.name} content to route step ${stepIndex + 1}.`
        : `Added route step ${stepIndex + 1} to ${circuit.name}.\n` +
            "Walk here during playback to trigger it."
    )
    return true
  }

  toggleFollow(): boolean {
    if (this.followActive) {
      this.followActive = false
      this.clearGuide()
      this.statusCallback(`Stopped following ${this.getActiveCircuitName()}.`)
      return false
    }

    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.statusCallback(
        `${this.getActiveCircuitName()} has no steps yet.\n` +
          "Add a step at a physical location first."
      )
      return false
    }

    this.followActive = true
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.lastStatusAt = 0
    this.updateGuide(steps)
    this.statusCallback(
      steps.length < 2
        ? `${this.getActiveCircuitName()} has one stop.\nAdd another Step+ somewhere else to create a path.`
        : `Go to start: step 1/${steps.length}.\nFollow the yellow guide marks, then hold at each stop.`
    )
    return true
  }

  stopFollow(): void {
    this.followActive = false
    this.nextStepIndex = 0
    this.enteredStepAt = -1
    this.clearGuide()
  }

  update(): void {
    if (!this.followActive) return

    const steps = this.getStepsForCircuit(this.getActiveCircuit().id)
    if (steps.length === 0) {
      this.followActive = false
      this.clearGuide()
      this.statusCallback(`${this.getActiveCircuitName()} has no steps.`)
      return
    }

    if (steps.length < 2) {
      const now = Date.now()
      if (now - this.lastStatusAt >= STATUS_UPDATE_INTERVAL_MS) {
        this.lastStatusAt = now
        this.updateGuide(steps)
        this.statusCallback(
          `${this.getActiveCircuitName()} needs another stop.\nMove to a second location and press Step+.`
        )
      }
      return
    }

    if (this.nextStepIndex >= steps.length) {
      this.followActive = false
      this.clearGuide()
      this.statusCallback(
        `${this.getActiveCircuitName()} complete.\n` +
          "Switch circuits to see the same route differently."
      )
      return
    }

    const currentStep = steps[this.nextStepIndex]
    const userPos = this.getCameraLocalPosition()
    const stepPos = this.getStepFollowPosition(currentStep)
    const distance = userPos.distance(stepPos)
    const now = Date.now()

    if (distance <= STEP_TRIGGER_RADIUS_CM) {
      if (this.enteredStepAt < 0) {
        this.enteredStepAt = now
        this.statusCallback(
          `At step ${this.nextStepIndex + 1}/${steps.length}.\nHold here to collect this stop.`
        )
        this.updateGuide(steps)
        this.lastStatusAt = now
        return
      }

      const heldFor = (now - this.enteredStepAt) / 1000
      if (heldFor < STEP_HOLD_SECONDS) {
        if (now - this.lastStatusAt >= STATUS_UPDATE_INTERVAL_MS) {
          this.statusCallback(
            `Hold at step ${this.nextStepIndex + 1}/${steps.length}.\n${Math.max(0.1, STEP_HOLD_SECONDS - heldFor).toFixed(1)}s left.`
          )
          this.lastStatusAt = now
        }
        return
      }

      this.statusCallback(this.buildStepReachedText(currentStep, steps.length))
      this.nextStepIndex++
      this.enteredStepAt = -1
      this.updateGuide(steps)
      this.lastStatusAt = now
      return
    }

    this.enteredStepAt = -1
    if (now - this.lastStatusAt < STATUS_UPDATE_INTERVAL_MS) return
    this.lastStatusAt = now
    this.updateGuide(steps)

    this.statusCallback(
      `Go to step ${this.nextStepIndex + 1}/${steps.length}: ${this.getStepLabel(currentStep)}.\n` +
        `${this.formatDistance(distance)} away. ${this.describeDirection(userPos, stepPos)}`
    )
  }

  applyActiveCircuitVisibility(): void {
    const activeId = this.getActiveCircuit().id
    for (const widget of this.widgetController.getWidgets()) {
      const note = this.asCircuitNote(widget)
      if (!note) continue

      const meta = note.getCircuitStep()
      const target = this.widgetController.getTransformTargetForWidget(widget)
      if (!target) continue

      target.enabled = !meta || meta.circuitId === activeId
    }

    if (this.followActive) {
      this.updateGuide()
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
      activeSteps,
      this.nextStepIndex,
      userPosition,
      directionHint
    )

    for (const step of this.getAllCircuitSteps()) {
      if (step.meta.circuitId !== this.getActiveCircuit().id) {
        step.widget.setGuideState("none")
        continue
      }

      if (step.meta.stepIndex === this.nextStepIndex) {
        step.widget.setGuideState("active")
      } else if (step.meta.stepIndex < this.nextStepIndex) {
        step.widget.setGuideState("visited")
      } else {
        step.widget.setGuideState("upcoming")
      }
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
    return noteText.length > 0
      ? `${step.meta.circuitName} step ${step.meta.stepIndex + 1}/${totalSteps}\n${noteText}\n${nextLine}`
      : `${step.meta.circuitName} step ${step.meta.stepIndex + 1}/${totalSteps}\n${nextLine}`
  }

  private getStepFollowPosition(step: CircuitStepRuntime): vec3 {
    return step.target.getTransform().getLocalPosition()
  }

  private getStepLabel(step: CircuitStepRuntime): string {
    const firstLine = step.text.trim().split("\n")[0]
    if (firstLine.length > 0) return firstLine
    return `Step ${step.meta.stepIndex + 1}`
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
