import Event, {PublicApi} from "SpectaclesInteractionKit.lspkg/Utils/Event"
import WorldCameraFinderProvider from "SpectaclesInteractionKit.lspkg/Providers/CameraProvider/WorldCameraFinderProvider"
import {Frame} from "SpectaclesUIKit.lspkg/Scripts/Components/Frame/Frame"
import {findAllComponentsInSelfOrChildren} from "SpectaclesInteractionKit.lspkg/Utils/SceneObjectUtils"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {WidgetBase} from "./WidgetBase"
import {WidgetType} from "./WidgetTypes"
import {NoteObjectFrameData, NoteWidget} from "./Types/NoteWidget"
import {WatchWidget} from "./Types/WatchWidget"
import {PhotoWidget} from "./Types/PhotoWidget"
import {CAMERA_GAZE_OFFSET} from "../Shared/Constants"
import {StorageController} from "../Storage/StorageController"
import {WidgetData} from "../App/AppState"

const WIDGET_CLASSES: Record<WidgetType, typeof BaseScriptComponent> = {
  [WidgetType.Note]: NoteWidget,
  [WidgetType.Watch]: WatchWidget,
  [WidgetType.Photo]: PhotoWidget,
}

// Lateral (x) and vertical (y) offsets per widget type so they don't overlap each other or the menu
const WIDGET_SPAWN_OFFSETS: Record<WidgetType, vec2> = {
  [WidgetType.Note]: new vec2(-12, 8),
  [WidgetType.Watch]: new vec2(0, 8),
  [WidgetType.Photo]: new vec2(12, 8),
}

const WIDGET_FRAME_SIZES: Record<WidgetType, vec2> = {
  [WidgetType.Note]: new vec2(15, 9.5),
  [WidgetType.Watch]: new vec2(14, 7),
  [WidgetType.Photo]: new vec2(14, 14),
}

const OBJECT_FRAME_MATERIAL = requireAsset("Materials/WidgetSelectionUIBackground.mat") as Material
const OBJECT_FRAME_DEFAULT_SIZE = new vec2(28, 22)
const OBJECT_FRAME_COLOR = new vec4(1, 0.86, 0.22, 0.95)
const OBJECT_FRAME_EDGE_THICKNESS = 0.65

interface ObjectFrameRuntime {
  root: SceneObject
  frame: Frame
  outlineRoot: SceneObject
  edges: SceneObject[]
}

export class WidgetController {
  private static instance: WidgetController

  private widgets: WidgetBase[] = []
  private widgetParent: SceneObject
  private logger: Logger
  private nextIndex: number = 0
  private prefabs: Record<string, ObjectPrefab>

  // Map widgetIndex → wrapper SceneObject (for cleanup — destroying wrapper destroys everything)
  private wrapperMap: Map<number, SceneObject> = new Map()

  // Map widgetIndex → Frame's SceneObject (for transforms — this is what InteractableManipulation moves)
  private frameObjMap: Map<number, SceneObject> = new Map()

  // Map widgetIndex → Frame component (for listening to translation events, etc.)
  private frameMap: Map<number, Frame> = new Map()

  // Map widgetIndex → separate spatial object outline owned by a note/step.
  private objectFrameMap: Map<number, ObjectFrameRuntime> = new Map()

  // Recall/minimize state: save transforms before minimize, restore on release
  private recallActive: boolean = false
  private savedPositions: Map<number, vec3> = new Map()
  private savedRotations: Map<number, quat> = new Map()
  private savedScales: Map<number, vec3> = new Map()

  private onWidgetAddedEvent = new Event<WidgetBase>()
  readonly onWidgetAdded: PublicApi<WidgetBase> =
    this.onWidgetAddedEvent.publicApi()

  private onWidgetRemovedEvent = new Event<WidgetBase>()
  readonly onWidgetRemoved: PublicApi<WidgetBase> =
    this.onWidgetRemovedEvent.publicApi()

  static getInstance(): WidgetController {
    if (!WidgetController.instance) {
      throw new Error("WidgetController not initialized")
    }
    return WidgetController.instance
  }

  constructor(
    widgetParent: SceneObject,
    logger: Logger,
    prefabs: Record<string, ObjectPrefab>
  ) {
    this.widgetParent = widgetParent
    this.logger = logger ?? new Logger("WidgetController", true, true)
    this.prefabs = prefabs
    WidgetController.instance = this
    this.logger.info("Initialized")
  }

  spawnWidget(
    type: WidgetType,
    storageCtrl: StorageController,
    areaName: string
  ): WidgetBase | null {
    const index = this.nextIndex++
    this.logger.info(`spawnWidget type=${type} index=${index}`)

    const prefab = this.prefabs[type]
    if (!prefab) {
      this.logger.error(`No prefab assigned for widget type: ${type}`)
      return null
    }

    // Instantiate prefab under a clean wrapper (not directly under widgetParent
    // which has AnchorComponent that can fight with InteractableManipulation).
    const wrapper = global.scene.createSceneObject(`Widget_${type}_${index}`)
    wrapper.setParent(this.widgetParent)

    let obj: SceneObject
    try {
      obj = prefab.instantiate(wrapper)
    } catch (e) {
      this.logger.error(`Prefab instantiation failed for ${type}: ${e}`)
      wrapper.destroy()
      return null
    }
    obj.name = `WidgetContent_${type}_${index}`

    // Find the specific widget component using class getTypeName() (engine-registered name)
    const WidgetClass = WIDGET_CLASSES[type]
    const widget = obj.getComponent(WidgetClass.getTypeName()) as WidgetBase
    if (!widget) {
      this.logger.error(`Prefab for ${type} missing ${WidgetClass.getTypeName()} component`)
      obj.destroy()
      wrapper.destroy()
      return null
    }

    widget.widgetType = type
    widget.widgetIndex = index

    // Store wrapper for cleanup
    this.wrapperMap.set(index, wrapper)

    // ── Copy settings from existing prefab Frame, then disable it ──
    // Prefab serialization captures Frame's field-initializer components (Collider,
    // Interactable, InteractableManipulation). At runtime instantiate() restores those
    // AND field initializers create new copies → duplicates → SIK registers the wrong one.
    // Fix: read the prefab Frame's design-time settings, then disable it entirely.
    let prefabInnerSize: vec2 | null = null
    let prefabAppearance: string | null = null
    let prefabPadding: vec2 | null = null

    const existingFrames = findAllComponentsInSelfOrChildren(obj, Frame.getTypeName())
    if (existingFrames.length > 0) {
      const sourceFrame = existingFrames[0] as Frame
      prefabInnerSize = sourceFrame.innerSize
      prefabAppearance = (sourceFrame as any)._appearance ?? null
      prefabPadding = sourceFrame.padding

      this.logger.info(
        `Copying prefab Frame settings: innerSize=${prefabInnerSize}, ` +
        `appearance=${prefabAppearance}, padding=${prefabPadding}`
      )

      for (const ef of existingFrames) {
        try {
          ;(ef as any)._initialized = true  // prevent deferred initialize()
          const oldFrame = ef as Frame
          if (oldFrame.collider) oldFrame.collider.enabled = false
          ;(ef as any)._interactable && ((ef as any)._interactable.enabled = false)
          ;(ef as any)._manipulate && ((ef as any)._manipulate.enabled = false)
        } catch (e) {
          this.logger.warn(`Error neutralizing old Frame: ${e}`)
        }
      }
    }

    // ── Create Frame programmatically on wrapper (same pattern as UIController) ──
    // Creating on wrapper (fresh SceneObject) avoids duplicate components entirely.
    // Frame.initialize() will reparent obj into a "content" child, which is fine.
    const frame = wrapper.createComponent(Frame.getTypeName()) as Frame

    // Apply prefab settings BEFORE initialize() — use backing fields directly
    // to avoid triggering setters that call scaleFrame() before _roundedRectangle exists.
    ;(frame as any).autoShowHide = false
    ;(frame as any).useBillboarding = true
    ;(frame as any).yAlways = true
    ;(frame as any).xAlways = false
    ;(frame as any)._allowScaling = false
    frame.allowTranslation = true
    ;(frame as any)._innerSize = WIDGET_FRAME_SIZES[type] ?? prefabInnerSize ?? new vec2(16, 10)
    ;(frame as any)._padding = new vec2(0, 0)
    if (prefabAppearance) (frame as any)._appearance = prefabAppearance

    // Explicit initialize() — bypasses OnStartEvent deferral (UIController pattern)
    frame.initialize()

    // Set runtime properties AFTER initialize() — now setters are safe
    frame.allowTranslation = true
    frame.allowScaling = false
    frame.innerSize = WIDGET_FRAME_SIZES[type] ?? prefabInnerSize ?? frame.innerSize
    frame.padding = new vec2(0, 0)
    frame.showVisual()

    const frameObj = wrapper
    this.frameMap.set(index, frame)
    this.frameObjMap.set(index, frameObj)
    this.refreshWidgetLayout(widget)

    // Position in front of camera with type-based lateral + vertical offset.
    // Compute in world space, then convert to LOCAL (anchor-relative) for storage consistency.
    const camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    const camPos = camTransform.getWorldPosition()
    const camRot = camTransform.getWorldRotation()
    const forward = camRot.multiplyVec3(new vec3(0, 0, -1))
    const right = camRot.multiplyVec3(new vec3(1, 0, 0))
    const up = camRot.multiplyVec3(new vec3(0, 1, 0))
    const offset = WIDGET_SPAWN_OFFSETS[type] ?? new vec2(0, 10)
    const spawnPos = camPos
      .add(forward.uniformScale(CAMERA_GAZE_OFFSET))
      .add(right.uniformScale(offset.x))
      .add(up.uniformScale(offset.y))
    // Convert world spawn position to local (relative to widgetParent/anchor)
    const parentTransform = this.widgetParent.getTransform()
    const parentWorldPos = parentTransform.getWorldPosition()
    const parentWorldRot = parentTransform.getWorldRotation()
    const invParentRot = parentWorldRot.invert()
    const localPos = invParentRot.multiplyVec3(spawnPos.sub(parentWorldPos))
    frameObj.getTransform().setLocalPosition(localPos)

    // Auto-save on content change
    widget.onContentChange.add(() => {
      this.refreshWidgetLayout(widget)
      this.saveAllWidgets(storageCtrl, areaName)
    })

    // Handle widget deletion
    widget.onDelete.add((idx: number) =>
      this.removeWidget(idx, storageCtrl, areaName)
    )

    this.widgets.push(widget)
    this.onWidgetAddedEvent.invoke(widget)
    const finalLocalPos = frameObj.getTransform().getLocalPosition()
    this.logger.info(
      `spawnWidget complete: index=${index} type=${type} wrapper="${wrapper.name}" ` +
      `frameObj="${frameObj.name}" localPos=${finalLocalPos} total=${this.widgets.length}`
    )
    return widget
  }

  restoreWidgets(areaName: string, storageCtrl: StorageController): void {
    this.logger.info(`restoreWidgets area="${areaName}"`)
    const data = storageCtrl.loadWidgets(areaName)

    for (const entry of data) {
      const widgetType = entry.type as WidgetType
      const widget = this.spawnWidget(widgetType, storageCtrl, areaName)
      if (!widget) continue

      if (entry.content) {
        widget.serializedContent = entry.content
        this.refreshWidgetLayout(widget)
      }

      if (widget.widgetType === WidgetType.Note) {
        this.syncObjectFrameForNote(widget as NoteWidget, storageCtrl, areaName)
      }

      const frameObj = this.getTransformTarget(widget)
      if (frameObj) {
        const t = frameObj.getTransform()
        // Use LOCAL transforms — positions are relative to widgetParent
        // (which is anchor-tracked). World coords change between sessions
        // as the anchor resolves to different world-space origins.
        t.setLocalPosition(entry.position)
        t.setLocalRotation(
          quat.fromEulerAngles(
            entry.rotation.x,
            entry.rotation.y,
            entry.rotation.z
          )
        )
      }
    }

    this.logger.info(
      `restoreWidgets complete, restored=${data.length}`
    )
  }

  saveAllWidgets(storageCtrl: StorageController, areaName: string): void {
    const data: WidgetData[] = this.widgets.map((w) => {
      const frameObj = this.getTransformTarget(w)
      const t = frameObj.getTransform()
      // Save LOCAL transforms — anchor-relative so they survive across sessions.
      // World coords shift each session as the anchor resolves to different origins.
      const euler = t.getLocalRotation().toEulerAngles()
      return {
        position: t.getLocalPosition(),
        rotation: euler,
        scale: new vec3(1, 1, 1),
        type: w.widgetType,
        content: w.serializedContent,
      }
    })
    storageCtrl.saveWidgets(areaName, data)
    if (this.logger) {
      this.logger.debug(
        `saveAllWidgets: ${data.length} widgets for "${areaName}"`
      )
    }
  }

  clearAllWidgets(): void {
    this.logger.info(`clearAllWidgets: destroying ${this.widgets.length} widgets`)

    for (const w of this.widgets) {
      try {
        // Destroy Frame component FIRST while its child SceneObjects (content)
        // are still alive — Frame's OnDestroyEvent accesses this.content.children
        // which crashes if content was already cascade-destroyed.
        const frame = this.frameMap.get(w.widgetIndex)
        if (frame) {
          try {
            frame.destroy()
          } catch (_) { /* component may already be invalid */ }
        }

        const wrapper = this.wrapperMap.get(w.widgetIndex)
        this.logger.info(
          `clearAllWidgets: widget ${w.widgetIndex} type=${w.widgetType} wrapper=${wrapper?.name ?? "null"}`
        )

        if (wrapper) {
          wrapper.destroy()
        } else {
          this.logger.warn(`clearAllWidgets: no wrapper for widget ${w.widgetIndex}, destroying SceneObject directly`)
          w.getSceneObject().destroy()
        }
      } catch (e) {
        this.logger.warn(`clearAllWidgets: error destroying widget ${w.widgetIndex}: ${e}`)
      }
    }

    // Nuclear cleanup: destroy any remaining children of widgetParent.
    // Guard each child individually — partially-initialized widgets (e.g. from
    // WebView crash) may have Frame components referencing null objects.
    try {
      const remaining = this.widgetParent.getChildrenCount()
      if (remaining > 0) {
        this.logger.warn(
          `clearAllWidgets: ${remaining} orphan children remain under widgetParent — destroying`
        )
        for (let i = remaining - 1; i >= 0; i--) {
          try {
            const child = this.widgetParent.getChild(i)
            this.logger.info(`clearAllWidgets: orphan child ${i}: "${child.name}"`)
            // Disable Frame components first to prevent their destroy handlers
            // from accessing already-null references
            const frames = findAllComponentsInSelfOrChildren(child, Frame.getTypeName())
            for (const f of frames) {
              try { (f as any)._initialized = false; f.enabled = false } catch (_) {}
            }
            child.destroy()
          } catch (e) {
            this.logger.warn(`clearAllWidgets: error destroying orphan ${i}: ${e}`)
          }
        }
      }
    } catch (e) {
      this.logger.warn(`clearAllWidgets: error during orphan cleanup: ${e}`)
    }

    this.widgets = []
    this.wrapperMap.clear()
    this.frameObjMap.clear()
    this.frameMap.clear()
    this.objectFrameMap.clear()
    this.nextIndex = 0
    this.recallActive = false
    this.savedPositions.clear()
    this.savedRotations.clear()
    this.savedScales.clear()
    this.logger.info("clearAllWidgets: done")
  }

  recallAllWidgets(cameraTransform: Transform): void {
    if (this.widgets.length === 0) return

    if (this.recallActive) {
      // Release: restore saved LOCAL transforms
      for (const w of this.widgets) {
        const frameObj = this.getTransformTarget(w)
        if (!frameObj) continue
        const t = frameObj.getTransform()
        const savedPos = this.savedPositions.get(w.widgetIndex)
        const savedRot = this.savedRotations.get(w.widgetIndex)
        const savedScale = this.savedScales.get(w.widgetIndex)
        if (savedPos) t.setLocalPosition(savedPos)
        if (savedRot) t.setLocalRotation(savedRot)
        if (savedScale) t.setLocalScale(savedScale)
      }
      this.savedPositions.clear()
      this.savedRotations.clear()
      this.savedScales.clear()
      this.recallActive = false
      this.logger.info("recallAllWidgets: released — restored original transforms")
      return
    }

    // Save current LOCAL transforms before minimize
    for (const w of this.widgets) {
      const frameObj = this.getTransformTarget(w)
      if (!frameObj) continue
      const t = frameObj.getTransform()
      this.savedPositions.set(w.widgetIndex, t.getLocalPosition())
      this.savedRotations.set(w.widgetIndex, t.getLocalRotation())
      this.savedScales.set(w.widgetIndex, t.getLocalScale())
    }

    // Arrange in grid: pick columns based on widget count
    const count = this.widgets.length
    const cols = Math.min(count, 8)
    const rows = Math.ceil(count / cols)
    const spacing = 40
    const minimizeScale = new vec3(0.6, 0.6, 0.6)

    const camPos = cameraTransform.getWorldPosition()
    const camRot = cameraTransform.getWorldRotation()
    const forward = camRot.multiplyVec3(new vec3(0, 0, -1))
    const right = camRot.multiplyVec3(new vec3(1, 0, 0))
    const up = camRot.multiplyVec3(new vec3(0, 1, 0))

    // Compute grid in world space, convert to local for anchor consistency
    const parentTransform = this.widgetParent.getTransform()
    const parentWorldPos = parentTransform.getWorldPosition()
    const parentWorldRot = parentTransform.getWorldRotation()
    const invParentRot = parentWorldRot.invert()

    const gridCenter = camPos.add(forward.uniformScale(CAMERA_GAZE_OFFSET))

    for (let i = 0; i < count; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)

      const xOffset = (col - (cols - 1) / 2) * spacing
      const yOffset = ((rows - 1) / 2 - row) * spacing

      const worldPos = gridCenter
        .add(right.uniformScale(xOffset))
        .add(up.uniformScale(yOffset))

      const frameObj = this.getTransformTarget(this.widgets[i])
      if (!frameObj) continue
      const t = frameObj.getTransform()
      const localPos = invParentRot.multiplyVec3(worldPos.sub(parentWorldPos))
      const localRot = invParentRot.multiply(camRot)
      t.setLocalPosition(localPos)
      t.setLocalRotation(localRot)
      t.setLocalScale(minimizeScale)
    }

    this.recallActive = true
    this.logger.info(
      `recallAllWidgets: minimized ${count} widgets in ${cols}x${rows} grid at 0.6 scale`
    )
  }

  isRecallActive(): boolean {
    return this.recallActive
  }

  getWidgets(): WidgetBase[] {
    return this.widgets.slice()
  }

  /** Get the SceneObjects that Frame/InteractableManipulation actually moves — for snap-to-surface etc. */
  getWidgetTransformTargets(): SceneObject[] {
    return this.widgets
      .map((w) => this.frameObjMap.get(w.widgetIndex))
      .filter((obj) => obj !== undefined)
  }

  /** Get Frame components for all widgets — for wiring translation events, etc. */
  getWidgetFrames(): {frame: Frame; sceneObject: SceneObject}[] {
    const result: {frame: Frame; sceneObject: SceneObject}[] = []
    for (const w of this.widgets) {
      const frame = this.frameMap.get(w.widgetIndex)
      const obj = this.frameObjMap.get(w.widgetIndex)
      if (frame && obj) {
        result.push({frame, sceneObject: obj})
      }
    }
    return result
  }

  /** Get the Frame component for a specific widget (for wiring events from outside). */
  getFrameForWidget(widget: WidgetBase): Frame | undefined {
    return this.frameMap.get(widget.widgetIndex)
  }

  /** Get the transform target (Frame's SceneObject) for a specific widget. */
  getTransformTargetForWidget(widget: WidgetBase): SceneObject | undefined {
    return this.frameObjMap.get(widget.widgetIndex)
  }

  setWidgetAuxiliaryVisibility(widget: WidgetBase, visible: boolean): void {
    const objectFrame = this.objectFrameMap.get(widget.widgetIndex)
    if (!objectFrame) return

    const note = widget.widgetType === WidgetType.Note
      ? (widget as NoteWidget)
      : null
    const frameEnabled = note?.getObjectFrameData()?.enabled === true
    objectFrame.root.enabled = visible && frameEnabled
  }

  setWidgetTransformInteractive(widget: WidgetBase, interactive: boolean): void {
    const frame = this.frameMap.get(widget.widgetIndex)
    if (!frame) return
    frame.allowTranslation = interactive
    frame.allowScaling = false
  }

  setNoteEditingEnabled(note: NoteWidget, enabled: boolean): void {
    note.setEditingEnabled(enabled)
  }

  setObjectFrameInteractiveForNote(note: NoteWidget, interactive: boolean): void {
    const runtime = this.objectFrameMap.get(note.widgetIndex)
    if (!runtime) return
    runtime.frame.allowTranslation = interactive
    runtime.frame.allowScaling = interactive
    runtime.frame.allowNonUniformScaling = interactive
  }

  toggleObjectFrameForNote(
    note: NoteWidget,
    storageCtrl: StorageController,
    areaName: string
  ): boolean {
    const current = note.getObjectFrameData()
    if (current?.enabled) {
      this.destroyObjectFrame(note.widgetIndex)
      note.setObjectFrameData(null)
      return false
    }

    const data = this.createDefaultObjectFrameData()
    note.setObjectFrameData(data, false)
    this.createObjectFrameForNote(note, data, storageCtrl, areaName)
    note.setObjectFrameData(this.readObjectFrameData(note) ?? data)
    return true
  }

  refreshWidgetLayout(widget: WidgetBase): void {
    const frame = this.frameMap.get(widget.widgetIndex)
    if (!frame) return

    if (widget.widgetType === WidgetType.Note) {
      const note = widget as NoteWidget
      const desiredSize = note.getDesiredFrameSize()
      frame.innerSize = desiredSize
      frame.padding = new vec2(0, 0)
      note.applyResponsiveLayout(desiredSize)
    } else {
      this.applyCompactWidgetLayout(widget.widgetType, widget)
    }
  }

  removeWidgetByIndex(
    index: number,
    storageCtrl: StorageController,
    areaName: string
  ): boolean {
    const widget = this.widgets.find((w) => w.widgetIndex === index)
    if (!widget) return false

    this.removeWidget(index, storageCtrl, areaName)
    return true
  }

  /**
   * Get the SceneObject that InteractableManipulation actually moves (Frame's SceneObject).
   * All transform read/write operations MUST use this, not the wrapper.
   */
  private getTransformTarget(w: WidgetBase): SceneObject {
    return this.frameObjMap.get(w.widgetIndex)
  }

  private syncObjectFrameForNote(
    note: NoteWidget,
    storageCtrl: StorageController,
    areaName: string
  ): void {
    const data = note.getObjectFrameData()
    if (data?.enabled) {
      this.createObjectFrameForNote(note, data, storageCtrl, areaName)
    } else {
      this.destroyObjectFrame(note.widgetIndex)
    }
  }

  private createObjectFrameForNote(
    note: NoteWidget,
    data: NoteObjectFrameData,
    storageCtrl: StorageController,
    areaName: string
  ): void {
    this.destroyObjectFrame(note.widgetIndex)

    const root = global.scene.createSceneObject(`ObjectFrame_${note.widgetIndex}`)
    root.setParent(this.widgetParent)
    root.getTransform().setLocalPosition(this.dataToVec3(data.position))
    root.getTransform().setLocalRotation(
      quat.fromEulerAngles(
        data.rotation.x,
        data.rotation.y,
        data.rotation.z
      )
    )

    const frame = root.createComponent(Frame.getTypeName()) as Frame
    ;(frame as any).autoShowHide = false
    ;(frame as any).useBillboarding = true
    ;(frame as any).xOnTranslate = true
    ;(frame as any).yOnTranslate = true
    ;(frame as any)._onlyInteractOnBorder = true
    ;(frame as any)._allowScaling = true
    ;(frame as any).allowNonUniformScaling = true
    ;(frame as any)._appearance = "Small"
    ;(frame as any)._innerSize = new vec2(data.size.x, data.size.y)
    ;(frame as any)._padding = new vec2(0, 0)
    ;(frame as any)._cutOutCenter = true
    frame.allowTranslation = true
    frame.initialize()
    frame.allowTranslation = true
    frame.allowScaling = true
    frame.allowNonUniformScaling = true
    frame.innerSize = new vec2(data.size.x, data.size.y)
    frame.padding = new vec2(0, 0)
    frame.cutOutCenter = true
    frame.border = 3
    frame.renderOrder = 18
    frame.roundedRectangle.renderMeshVisual.enabled = false

    frame.onTranslationEnd.add(() => {
      this.persistObjectFrameState(note, storageCtrl, areaName)
    })
    frame.onScalingUpdate.add(() => {
      const runtime = this.objectFrameMap.get(note.widgetIndex)
      if (runtime) {
        this.hideNativeObjectFrameVisual(runtime.frame)
        this.updateObjectFrameOutline(runtime)
      }
    })
    frame.onScalingEnd.add(() => {
      const runtime = this.objectFrameMap.get(note.widgetIndex)
      if (runtime) {
        this.hideNativeObjectFrameVisual(runtime.frame)
        this.updateObjectFrameOutline(runtime)
      }
      this.persistObjectFrameState(note, storageCtrl, areaName)
    })
    frame.onSnappingComplete.add(() => {
      this.persistObjectFrameState(note, storageCtrl, areaName)
    })

    const outlineRoot = global.scene.createSceneObject(`ObjectFrameOutline_${note.widgetIndex}`)
    outlineRoot.setParent(root)
    outlineRoot.getTransform().setLocalPosition(new vec3(0, 0, 0.85))
    const runtime = {
      root,
      frame,
      outlineRoot,
      edges: this.createObjectFrameEdges(outlineRoot),
    }
    this.objectFrameMap.set(note.widgetIndex, runtime)
    this.hideNativeObjectFrameVisual(frame)
    this.updateObjectFrameOutline(runtime)
  }

  private persistObjectFrameState(
    note: NoteWidget,
    storageCtrl: StorageController,
    areaName: string
  ): void {
    const data = this.readObjectFrameData(note)
    if (!data) return

    note.setObjectFrameData(data, false)
    this.saveAllWidgets(storageCtrl, areaName)
  }

  private readObjectFrameData(note: NoteWidget): NoteObjectFrameData | null {
    const objectFrame = this.objectFrameMap.get(note.widgetIndex)
    if (!objectFrame) return null

    const transform = objectFrame.root.getTransform()
    return {
      enabled: true,
      position: this.vec3ToData(transform.getLocalPosition()),
      rotation: this.vec3ToData(transform.getLocalRotation().toEulerAngles()),
      size: {
        x: objectFrame.frame.innerSize.x,
        y: objectFrame.frame.innerSize.y,
      },
    }
  }

  private createDefaultObjectFrameData(): NoteObjectFrameData {
    const camTransform = WorldCameraFinderProvider.getInstance().getTransform()
    const camPos = camTransform.getWorldPosition()
    const camRot = camTransform.getWorldRotation()
    const forward = camRot.multiplyVec3(new vec3(0, 0, -1))
    const spawnPos = camPos.add(forward.uniformScale(CAMERA_GAZE_OFFSET))

    const parentTransform = this.widgetParent.getTransform()
    const parentWorldPos = parentTransform.getWorldPosition()
    const parentWorldRot = parentTransform.getWorldRotation()
    const invParentRot = parentWorldRot.invert()
    const localPos = invParentRot.multiplyVec3(spawnPos.sub(parentWorldPos))
    const localRot = invParentRot.multiply(camRot)

    return {
      enabled: true,
      position: this.vec3ToData(localPos),
      rotation: this.vec3ToData(localRot.toEulerAngles()),
      size: {
        x: OBJECT_FRAME_DEFAULT_SIZE.x,
        y: OBJECT_FRAME_DEFAULT_SIZE.y,
      },
    }
  }

  private destroyObjectFrame(widgetIndex: number): void {
    const objectFrame = this.objectFrameMap.get(widgetIndex)
    if (!objectFrame) return
    objectFrame.root.destroy()
    this.objectFrameMap.delete(widgetIndex)
  }

  private hideNativeObjectFrameVisual(frame: Frame): void {
    try {
      frame.roundedRectangle.renderMeshVisual.enabled = false
    } catch (_) {}
  }

  private createObjectFrameEdges(parent: SceneObject): SceneObject[] {
    const names = ["Top", "Bottom", "Left", "Right"]
    return names.map((name) => {
      const edge = global.scene.createSceneObject(`ObjectFrameEdge_${name}`)
      edge.setParent(parent)

      const visual = edge.createComponent("Component.RenderMeshVisual") as RenderMeshVisual
      visual.mesh = this.createQuadMesh()
      visual.mainMaterial = OBJECT_FRAME_MATERIAL.clone()
      visual.mainMaterial.mainPass.baseColor = OBJECT_FRAME_COLOR
      visual.mainMaterial.mainPass.depthTest = false
      visual.mainMaterial.mainPass.twoSided = true
      visual.setRenderOrder(22)
      return edge
    })
  }

  private updateObjectFrameOutline(runtime: ObjectFrameRuntime): void {
    const width = Math.max(8, runtime.frame.innerSize.x)
    const height = Math.max(8, runtime.frame.innerSize.y)
    const thickness = OBJECT_FRAME_EDGE_THICKNESS
    const [top, bottom, left, right] = runtime.edges

    this.layoutObjectFrameEdge(
      top,
      new vec3(0, height * 0.5, 0),
      new vec3(width + thickness, thickness, 1)
    )
    this.layoutObjectFrameEdge(
      bottom,
      new vec3(0, -height * 0.5, 0),
      new vec3(width + thickness, thickness, 1)
    )
    this.layoutObjectFrameEdge(
      left,
      new vec3(-width * 0.5, 0, 0),
      new vec3(thickness, height + thickness, 1)
    )
    this.layoutObjectFrameEdge(
      right,
      new vec3(width * 0.5, 0, 0),
      new vec3(thickness, height + thickness, 1)
    )
  }

  private layoutObjectFrameEdge(
    edge: SceneObject,
    position: vec3,
    scale: vec3
  ): void {
    const transform = edge.getTransform()
    transform.setLocalPosition(position)
    transform.setLocalScale(scale)
  }

  private createQuadMesh(): RenderMesh {
    const builder = new MeshBuilder([
      {name: "position", components: 3},
      {name: "normal", components: 3},
    ])
    builder.topology = MeshTopology.Triangles
    builder.indexType = MeshIndexType.UInt16
    builder.appendVerticesInterleaved([
      -0.5, -0.5, 0, 0, 0, 1,
      0.5, -0.5, 0, 0, 0, 1,
      0.5, 0.5, 0, 0, 0, 1,
      -0.5, 0.5, 0, 0, 0, 1,
    ])
    builder.appendIndices([0, 1, 2, 0, 2, 3])
    builder.updateMesh()
    return builder.getMesh()
  }

  private vec3ToData(value: vec3): {x: number; y: number; z: number} {
    return {
      x: value.x,
      y: value.y,
      z: value.z,
    }
  }

  private dataToVec3(value: {x: number; y: number; z: number}): vec3 {
    return new vec3(value.x, value.y, value.z)
  }

  private applyCompactWidgetLayout(type: WidgetType, widget: WidgetBase): void {
    if (type === WidgetType.Note) {
      ;(widget as NoteWidget).applyCompactLayout()
    } else if (type === WidgetType.Watch) {
      ;(widget as WatchWidget).applyCompactLayout()
    } else if (type === WidgetType.Photo) {
      ;(widget as PhotoWidget).applyCompactLayout()
    }
  }

  private removeWidget(
    index: number,
    storageCtrl: StorageController,
    areaName: string
  ): void {
    const widget = this.widgets.find((w) => w.widgetIndex === index)
    if (!widget) return

    this.logger.info(`removeWidget index=${index}`)
    this.destroyObjectFrame(index)
    const wrapper = this.wrapperMap.get(index)
    if (wrapper) {
      wrapper.destroy()
    }
    this.wrapperMap.delete(index)
    this.frameObjMap.delete(index)
    this.frameMap.delete(index)
    this.widgets = this.widgets.filter((w) => w.widgetIndex !== index)
    this.onWidgetRemovedEvent.invoke(widget)
    this.saveAllWidgets(storageCtrl, areaName)
  }
}
