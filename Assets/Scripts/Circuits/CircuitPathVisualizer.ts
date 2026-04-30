import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {CircuitStepMeta} from "./CircuitTypes"

const GUIDE_MATERIAL = requireAsset("../../Materials/WidgetSelectionUIBackground.mat") as Material

const ACTIVE_COLOR = new vec4(1, 0.86, 0.22, 0.95)
const VISITED_COLOR = new vec4(0.42, 0.96, 0.98, 0.84)
const UPCOMING_COLOR = new vec4(1, 1, 1, 0.58)
const PIN_DARK_COLOR = new vec4(0.1, 0.1, 0.1, 0.86)

const ROUTE_THICKNESS = 1.05
const ACTIVE_THICKNESS = 1.55
const LEAD_THICKNESS = 1.35
const CURVE_SUBDIVISIONS = 6

export interface CircuitPathGuideStep {
  target: SceneObject
  meta: CircuitStepMeta
}

export class CircuitPathVisualizer {
  private parent: SceneObject
  private logger: Logger
  private root: SceneObject | null = null

  constructor(parent: SceneObject, logger: Logger) {
    this.parent = parent
    this.logger = logger
  }

  render(
    steps: CircuitPathGuideStep[],
    activeStepIndex: number,
    userPosition?: vec3,
    directionHint?: string
  ): void {
    this.clear()

    if (steps.length === 0) return

    this.root = global.scene.createSceneObject("CircuitPathGuide")
    this.root.setParent(this.parent)

    this.createRouteConnections(steps, activeStepIndex)

    if (userPosition && activeStepIndex >= 0 && activeStepIndex < steps.length) {
      const target = this.getGuidePoint(
        steps[activeStepIndex].target.getTransform().getLocalPosition()
      )
      this.createLeadInConnection(userPosition, target, activeStepIndex, directionHint)
    }

    for (let i = 0; i < steps.length; i++) {
      const pos = steps[i].target.getTransform().getLocalPosition()
      const state = this.getStepState(i, activeStepIndex)
      this.createStepPin(`${i + 1}`, pos, state, i, steps.length)
    }

    this.logger.debug(
      `CircuitPathVisualizer rendered ${steps.length} steps, active=${activeStepIndex}`
    )
  }

  clear(): void {
    if (!this.root) return
    this.root.destroy()
    this.root = null
  }

  private createRouteConnections(
    steps: CircuitPathGuideStep[],
    activeStepIndex: number
  ): void {
    if (!this.root || steps.length < 2) return

    const allStepsVisited = activeStepIndex >= steps.length
    const activeSegmentIndex = activeStepIndex <= 0 ? 0 : activeStepIndex - 1

    for (let i = 0; i < steps.length - 1; i++) {
      const start = this.getGuidePoint(steps[i].target.getTransform().getLocalPosition())
      const end = this.getGuidePoint(steps[i + 1].target.getTransform().getLocalPosition())
      const isActive = !allStepsVisited && i === activeSegmentIndex
      const isVisited = allStepsVisited || i < activeSegmentIndex
      const color = isActive ? ACTIVE_COLOR : isVisited ? VISITED_COLOR : UPCOMING_COLOR
      const thickness = isActive ? ACTIVE_THICKNESS : ROUTE_THICKNESS

      this.createCurvedConnection(
        start,
        end,
        color,
        thickness,
        `RouteSegment_${i}`,
        isActive ? 0.09 : 0.06,
        isActive ? 0.045 : 0.025
      )

      if (isActive) {
        const mid = start.add(end).uniformScale(0.5).add(new vec3(0, 7, 3.5))
        this.createTextMarker("NEXT LEG", mid, 23, ACTIVE_COLOR, new vec2(8, 1.7))
      } else if (isVisited) {
        const mid = start.add(end).uniformScale(0.5).add(new vec3(0, 5.2, 3.2))
        this.createTextMarker("DONE", mid, 18, VISITED_COLOR, new vec2(5, 1.4))
      }
    }
  }

  private createLeadInConnection(
    userPosition: vec3,
    target: vec3,
    activeStepIndex: number,
    directionHint?: string
  ): void {
    if (!this.root) return

    const delta = target.sub(userPosition)
    const distance = userPosition.distance(target)
    if (distance < 8) return

    const leadStart = distance > 45
      ? userPosition.add(delta.normalize().uniformScale(32))
      : userPosition

    this.createCurvedConnection(
      leadStart,
      target,
      ACTIVE_COLOR,
      LEAD_THICKNESS,
      "LeadIn",
      0.055,
      0.02
    )

    const callout = directionHint
      ? `STEP ${activeStepIndex + 1}\n${directionHint}`
      : `STEP ${activeStepIndex + 1}\nFollow yellow line`
    const labelPos = leadStart.add(target).uniformScale(0.5).add(new vec3(0, 12, 5.5))
    this.createTextMarker(callout, labelPos, 24, ACTIVE_COLOR, new vec2(15, 3.2))
  }

  private createCurvedConnection(
    start: vec3,
    end: vec3,
    color: vec4,
    thickness: number,
    name: string,
    curveHeightMultiplier: number,
    meanderFactor: number
  ): void {
    const sampled = this.buildCurvedPoints(
      [start, end],
      CURVE_SUBDIVISIONS,
      curveHeightMultiplier,
      meanderFactor
    )

    for (let i = 0; i < sampled.length - 1; i++) {
      this.createTubeSegment(
        sampled[i],
        sampled[i + 1],
        color,
        thickness,
        `${name}_${i}`
      )
    }
  }

  private createStepPin(
    label: string,
    pos: vec3,
    state: "active" | "visited" | "upcoming",
    index: number,
    total: number
  ): void {
    if (!this.root) return

    const color =
      state === "active"
        ? ACTIVE_COLOR
        : state === "visited"
          ? VISITED_COLOR
          : UPCOMING_COLOR
    const prefix =
      state === "active"
        ? "NOW"
        : state === "visited"
          ? "DONE"
          : index === 0
            ? "START"
            : index === total - 1
              ? "FINISH"
              : "STEP"
    const pinCenter = pos.add(new vec3(0, 8.5, 4.5))
    const stemStart = this.getGuidePoint(pos)
    const stemEnd = pinCenter.add(new vec3(0, -2.9, 0))
    const pinSize = state === "active" ? 5.2 : 4.4

    this.createTubeSegment(stemStart, stemEnd, color, 0.62, `PinStem_${label}`)
    this.createDisc(pinCenter, color, pinSize, `Pin_${label}`)
    this.createDisc(pinCenter.add(new vec3(0, 0, 0.08)), PIN_DARK_COLOR, pinSize * 0.62, `PinInner_${label}`)

    this.createTextMarker(
      label,
      pinCenter.add(new vec3(0, 0.05, 0.25)),
      state === "active" ? 34 : 28,
      color,
      new vec2(pinSize, pinSize * 0.78)
    )

    this.createTextMarker(
      prefix,
      pinCenter.add(new vec3(0, pinSize * 0.78, 0.15)),
      state === "active" ? 20 : 17,
      color,
      new vec2(7.5, 1.4)
    )
  }

  private createDisc(position: vec3, color: vec4, diameter: number, name: string): void {
    if (!this.root) return

    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.root)
    obj.getTransform().setLocalPosition(position)

    const mesh = this.createDiscMesh(diameter * 0.5, 28)
    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = mesh
    visual.mainMaterial = GUIDE_MATERIAL.clone()
    visual.mainMaterial.mainPass.baseColor = color
    visual.mainMaterial.mainPass.depthTest = false
    visual.setRenderOrder(15)
  }

  private createTubeSegment(
    start: vec3,
    end: vec3,
    color: vec4,
    thickness: number,
    name: string
  ): void {
    if (!this.root) return

    const distance = start.distance(end)
    if (distance < 0.5) return

    const obj = global.scene.createSceneObject(name)
    obj.setParent(this.root)
    obj.getTransform().setLocalPosition(start.add(end).uniformScale(0.5))
    obj.getTransform().setLocalRotation(
      this.rotationFromUpToDirection(end.sub(start).normalize())
    )

    const visual = obj.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
    visual.mesh = this.createTubeMesh(distance, thickness * 0.5, 10)
    visual.mainMaterial = GUIDE_MATERIAL.clone()
    visual.mainMaterial.mainPass.baseColor = color
    visual.mainMaterial.mainPass.depthTest = false
    visual.setRenderOrder(13)
  }

  private createTubeMesh(length: number, radius: number, sides: number): RenderMesh {
    const builder = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3},
    ])
    const vertices: number[] = []
    const indices: number[] = []
    const half = length * 0.5

    builder.topology = MeshTopology.Triangles
    builder.indexType = MeshIndexType.UInt16

    for (let i = 0; i < sides; i++) {
      const angle = (i / sides) * Math.PI * 2
      const x = Math.cos(angle) * radius
      const z = Math.sin(angle) * radius
      const nx = Math.cos(angle)
      const nz = Math.sin(angle)
      vertices.push(x, -half, z, nx, 0, nz)
      vertices.push(x, half, z, nx, 0, nz)
    }

    for (let i = 0; i < sides; i++) {
      const next = (i + 1) % sides
      const bottom = i * 2
      const top = bottom + 1
      const nextBottom = next * 2
      const nextTop = nextBottom + 1
      indices.push(bottom, top, nextTop, bottom, nextTop, nextBottom)
    }

    builder.appendIndices(indices)
    builder.appendVerticesInterleaved(vertices)
    builder.updateMesh()
    return builder.getMesh()
  }

  private createDiscMesh(radius: number, segments: number): RenderMesh {
    const builder = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3},
    ])
    const vertices: number[] = [0, 0, 0, 0, 0, 1]
    const indices: number[] = []

    builder.topology = MeshTopology.Triangles
    builder.indexType = MeshIndexType.UInt16

    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      vertices.push(Math.cos(angle) * radius, Math.sin(angle) * radius, 0, 0, 0, 1)
    }

    for (let i = 1; i <= segments; i++) {
      indices.push(0, i, i + 1, 0, i + 1, i)
    }

    builder.appendIndices(indices)
    builder.appendVerticesInterleaved(vertices)
    builder.updateMesh()
    return builder.getMesh()
  }

  private createTextMarker(
    text: string,
    position: vec3,
    size: number,
    color: vec4,
    rectSize: vec2
  ): void {
    if (!this.root) return

    const obj = global.scene.createSceneObject(`Guide_${text.replace(/\s/g, "_")}`)
    obj.setParent(this.root)
    obj.getTransform().setLocalPosition(position)

    const textComp = obj.createComponent("Component.Text") as Text
    textComp.text = text
    textComp.size = size
    textComp.worldSpaceRect = Rect.create(
      -rectSize.x * 0.5,
      rectSize.x * 0.5,
      -rectSize.y * 0.5,
      rectSize.y * 0.5
    )
    textComp.horizontalOverflow = HorizontalOverflow.Shrink
    textComp.verticalOverflow = VerticalOverflow.Shrink
    textComp.horizontalAlignment = HorizontalAlignment.Center
    textComp.verticalAlignment = VerticalAlignment.Center
    textComp.textFill.mode = TextFillMode.Solid
    textComp.textFill.color = color
    textComp.renderOrder = 16
  }

  private getGuidePoint(pos: vec3): vec3 {
    return pos.add(new vec3(0, 2.4, 3.2))
  }

  private buildCurvedPoints(
    points: vec3[],
    subdivisionsPerSegment: number,
    curveHeightMultiplier: number,
    meanderFactor: number
  ): vec3[] {
    const result: vec3[] = []
    if (points.length < 2) return points

    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]
      const b = points[i + 1]
      const direction = b.sub(a)
      const length = a.distance(b)
      const dirNorm = length > 0.0001 ? direction.normalize() : vec3.forward()
      const mid = a.add(b).uniformScale(0.5)
      const curveHeight = length * curveHeightMultiplier
      let control = mid.add(vec3.up().uniformScale(curveHeight))
      let perp = dirNorm.cross(vec3.up())
      const perpLen = perp.length

      if (perpLen < 0.0001) {
        perp = new vec3(1, 0, 0)
      } else {
        perp = perp.uniformScale(1 / perpLen)
      }

      const sign = i % 2 === 0 ? 1 : -1
      control = control.add(perp.uniformScale(length * meanderFactor * sign))

      for (let s = 0; s <= subdivisionsPerSegment; s++) {
        result.push(this.quadInterp(a, b, control, s / subdivisionsPerSegment))
      }
    }
    return result
  }

  private quadInterp(a: vec3, b: vec3, c: vec3, t: number): vec3 {
    const omt = 1 - t
    return a
      .uniformScale(omt * omt)
      .add(c.uniformScale(2 * omt * t))
      .add(b.uniformScale(t * t))
  }

  private rotationFromUpToDirection(direction: vec3): quat {
    const up = vec3.up()
    const axis = up.cross(direction)
    const axisLength = axis.length
    const dot = Math.max(-1, Math.min(1, up.dot(direction)))

    if (axisLength > 0.000001) {
      return quat.angleAxis(Math.acos(dot), axis.uniformScale(1 / axisLength))
    }

    if (dot < 0) {
      return quat.angleAxis(Math.PI, new vec3(1, 0, 0))
    }

    return quat.angleAxis(0, up)
  }

  private getStepState(
    stepIndex: number,
    activeStepIndex: number
  ): "active" | "visited" | "upcoming" {
    if (stepIndex === activeStepIndex) return "active"
    if (stepIndex < activeStepIndex) return "visited"
    return "upcoming"
  }
}
