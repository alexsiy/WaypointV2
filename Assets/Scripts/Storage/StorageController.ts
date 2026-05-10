/**
 * Singleton controller for all persistent storage operations.
 * Manages area CRUD and widget data serialization via global.persistentStorageSystem.
 */
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {WidgetData} from "../App/AppState"
import {
  areasMapKey,
  lastAreaKey,
  lastCircuitKey,
  widgetKey,
  TRANSFORM_KEY,
  TYPE_KEY,
  CONTENT_KEY,
  ANCHOR_POSE_KEY,
  voiceNoteKey,
  voiceNotePrefix,
} from "./StorageKeys"

/**
 * Maps area display names to their internal anchor area IDs.
 */
interface AreaNameToAreaId {
  [name: string]: string
}

export class StorageController {
  private static instance: StorageController

  private logger: Logger
  private persistentStorage = global.persistentStorageSystem.store

  private constructor() {
    this.logger = new Logger("StorageController", true, true)
  }

  static getInstance(): StorageController {
    if (StorageController.instance) {
      return StorageController.instance
    }
    StorageController.instance = new StorageController()
    return StorageController.instance
  }

  // -------------------------------------------------------
  // Areas
  // -------------------------------------------------------

  /** Returns the full area-name → area-id map from persistent storage. */
  getAreas(): Record<string, string> {
    try {
      const json = this.persistentStorage.getString(areasMapKey())
      if (!json || json === "") {
        return {}
      }
      return JSON.parse(json) as AreaNameToAreaId
    } catch (e) {
      this.logger.error(`Error loading areas: ${e}`)
      return {}
    }
  }

  /** Persists a new or updated area entry. */
  saveArea(name: string, id: string): void {
    try {
      const areas = this.getAreas()
      areas[name] = id
      this.persistentStorage.putString(areasMapKey(), JSON.stringify(areas))
      this.logger.info(`Saved area "${name}" with id ${id}`)
    } catch (e) {
      this.logger.error(`Error saving area: ${e}`)
    }
  }

  /** Removes an area and its associated widget data. */
  deleteArea(name: string): void {
    try {
      // Remove widget data first
      this.clearWidgets(name)

      // Remove from the areas map
      const areas = this.getAreas()
      delete areas[name]
      this.persistentStorage.putString(areasMapKey(), JSON.stringify(areas))
      this.logger.info(`Deleted area "${name}"`)
    } catch (e) {
      this.logger.error(`Error deleting area: ${e}`)
    }
  }

  /** Removes all areas and all widget data. */
  clearAllAreas(): void {
    try {
      const areas = this.getAreas()
      for (const name of Object.keys(areas)) {
        this.clearWidgets(name)
      }
      this.persistentStorage.putString(areasMapKey(), JSON.stringify({}))
      this.persistentStorage.putString(lastAreaKey(), "")
      // Clear the spatial anchor model state — stale location references
      // cause crashes in LocationAsset.fromSerialized() on next session
      this.persistentStorage.putString("locationModelState", "")
      this.logger.info("Cleared all areas and spatial anchor state")
    } catch (e) {
      this.logger.error(`Error clearing all areas: ${e}`)
    }
  }

  /** Returns the number of currently saved areas. */
  getAreaCount(): number {
    return Object.keys(this.getAreas()).length
  }

  /** Persists the last area entered from the start/resume flow. */
  saveLastAreaName(areaName: string): void {
    try {
      this.persistentStorage.putString(lastAreaKey(), areaName)
      this.logger.info(`Saved last area "${areaName}"`)
    } catch (e) {
      this.logger.error(`Error saving last area: ${e}`)
    }
  }

  /** Returns the last opened area name, if it still exists. */
  getLastAreaName(): string | null {
    try {
      const name = this.persistentStorage.getString(lastAreaKey())
      if (!name || name === "") return null
      const areas = this.getAreas()
      return name in areas ? name : null
    } catch (e) {
      this.logger.error(`Error loading last area: ${e}`)
      return null
    }
  }

  /** Persists the last selected circuit index for an area. */
  saveLastCircuitIndex(areaName: string, index: number): void {
    try {
      this.persistentStorage.putString(lastCircuitKey(areaName), `${index}`)
    } catch (e) {
      this.logger.error(`Error saving last circuit: ${e}`)
    }
  }

  /** Returns the last selected circuit index for an area. */
  getLastCircuitIndex(areaName: string): number | null {
    try {
      const raw = this.persistentStorage.getString(lastCircuitKey(areaName))
      if (!raw || raw === "") return null
      const parsed = parseInt(raw, 10)
      return isNaN(parsed) ? null : parsed
    } catch (e) {
      this.logger.error(`Error loading last circuit: ${e}`)
      return null
    }
  }

  // -------------------------------------------------------
  // Widgets
  // -------------------------------------------------------

  /**
   * Saves an array of widget data for a given area.
   * Each widget's transform is encoded as a mat3 (col0=position, col1=rotation euler, col2=scale).
   * Type and content are stored as parallel arrays.
   */
  saveWidgets(areaName: string, widgets: WidgetData[]): void {
    try {
      const transforms: mat3[] = []
      const types: string[] = []
      const contents: string[] = []

      for (const w of widgets) {
        const m = new mat3()
        m.column0 = w.position
        m.column1 = w.rotation
        m.column2 = w.scale
        transforms.push(m)
        types.push(w.type)
        contents.push(w.content)
      }

      this.persistentStorage.putMat3Array(widgetKey(areaName, TRANSFORM_KEY), transforms)
      this.persistentStorage.putStringArray(widgetKey(areaName, TYPE_KEY), types)
      this.persistentStorage.putStringArray(widgetKey(areaName, CONTENT_KEY), contents)

      this.logger.info(`Saved ${widgets.length} widgets for area "${areaName}"`)
    } catch (e) {
      this.logger.error(`Error saving widgets: ${e}`)
    }
  }

  /**
   * Loads widget data for a given area. Returns an empty array if no data found.
   */
  loadWidgets(areaName: string): WidgetData[] {
    try {
      const transforms = this.persistentStorage.getMat3Array(widgetKey(areaName, TRANSFORM_KEY))
      const types = this.persistentStorage.getStringArray(widgetKey(areaName, TYPE_KEY))
      const contents = this.persistentStorage.getStringArray(widgetKey(areaName, CONTENT_KEY))

      if (!transforms || transforms.length === 0) {
        return []
      }

      const widgets: WidgetData[] = []
      for (let i = 0; i < transforms.length; i++) {
        widgets.push({
          position: transforms[i].column0,
          rotation: transforms[i].column1,
          scale: transforms[i].column2,
          type: types[i] ?? "note",
          content: contents[i] ?? "",
        })
      }

      this.logger.info(`Loaded ${widgets.length} widgets for area "${areaName}"`)
      return widgets
    } catch (e) {
      this.logger.error(`Error loading widgets: ${e}`)
      return []
    }
  }

  /** Removes all widget data for the specified area. */
  clearWidgets(areaName: string): void {
    try {
      this.persistentStorage.remove(widgetKey(areaName, TRANSFORM_KEY))
      this.persistentStorage.remove(widgetKey(areaName, TYPE_KEY))
      this.persistentStorage.remove(widgetKey(areaName, CONTENT_KEY))
      this.persistentStorage.remove(widgetKey(areaName, ANCHOR_POSE_KEY))
      this.persistentStorage.remove(lastCircuitKey(areaName))
      this.clearVoiceNotes(areaName)
      this.logger.info(`Cleared widgets for area "${areaName}"`)
    } catch (e) {
      this.logger.error(`Error clearing widgets: ${e}`)
    }
  }

  // -------------------------------------------------------
  // Voice notes
  // -------------------------------------------------------

  /** Persists voice-note samples in compact PCM16 form for a specific area. */
  saveVoiceNote(areaName: string, voiceId: string, samples: any): boolean {
    try {
      const encoded = this.encodeVoiceSamples(samples)
      this.persistentStorage.putInt16Array(voiceNoteKey(areaName, voiceId), encoded)
      this.logger.info(
        `Saved voice note "${voiceId}" for "${areaName}" (${encoded.length} samples)`
      )
      return true
    } catch (e) {
      this.logger.error(`Error saving voice note: ${e}`)
      return false
    }
  }

  /** Loads a voice-note sample buffer as Float32 audio, or null if none exists. */
  loadVoiceNote(areaName: string, voiceId: string): Float32Array | null {
    const key = voiceNoteKey(areaName, voiceId)
    try {
      if (!this.persistentStorage.has(key)) {
        return null
      }
      const encoded = this.persistentStorage.getInt16Array(key)
      if (encoded && encoded.length > 0) {
        return this.decodeVoiceSamples(encoded)
      }
    } catch (e) {
      this.logger.warn(`PCM16 voice note load failed, trying legacy Float32: ${e}`)
    }

    try {
      const legacySamples = this.persistentStorage.getFloat32Array(key)
      return legacySamples && legacySamples.length > 0 ? legacySamples : null
    } catch (e) {
      this.logger.error(`Error loading voice note: ${e}`)
      return null
    }
  }

  /** Removes one persisted voice note. */
  deleteVoiceNote(areaName: string, voiceId: string): void {
    try {
      this.persistentStorage.remove(voiceNoteKey(areaName, voiceId))
    } catch (e) {
      this.logger.error(`Error deleting voice note: ${e}`)
    }
  }

  /** Removes every persisted voice note for the area. */
  clearVoiceNotes(areaName: string): void {
    try {
      const prefix = voiceNotePrefix(areaName)
      const keys = this.persistentStorage.getAllKeys()
      for (const key of keys) {
        if (key.indexOf(prefix) === 0) {
          this.persistentStorage.remove(key)
        }
      }
    } catch (e) {
      this.logger.error(`Error clearing voice notes: ${e}`)
    }
  }

  private encodeVoiceSamples(samples: any): Int16Array {
    if (samples instanceof Int16Array) {
      return samples
    }

    const encoded = new Int16Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
      encoded[i] = Math.round(clamped * 32767)
    }
    return encoded
  }

  private decodeVoiceSamples(samples: Int16Array): Float32Array {
    const decoded = new Float32Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      decoded[i] = samples[i] / 32768.0
    }
    return decoded
  }

  // -------------------------------------------------------
  // Anchor pose (fallback for when anchor save doesn't persist)
  // -------------------------------------------------------

  /**
   * Saves the anchor pose (widgetParent world position + rotation) for an area.
   * Used as fallback to position widgets when the anchor can't be rediscovered.
   */
  saveAnchorPose(areaName: string, position: vec3, rotation: quat): void {
    try {
      const data = JSON.stringify({
        px: position.x, py: position.y, pz: position.z,
        rx: rotation.x, ry: rotation.y, rz: rotation.z, rw: rotation.w,
      })
      this.persistentStorage.putString(widgetKey(areaName, ANCHOR_POSE_KEY), data)
      this.logger.info(`Saved anchor pose for "${areaName}"`)
    } catch (e) {
      this.logger.error(`Error saving anchor pose: ${e}`)
    }
  }

  /**
   * Loads the saved anchor pose for an area.
   * Returns null if no pose was saved.
   */
  loadAnchorPose(areaName: string): {position: vec3, rotation: quat} | null {
    try {
      const data = this.persistentStorage.getString(widgetKey(areaName, ANCHOR_POSE_KEY))
      if (!data || data === "") return null
      const obj = JSON.parse(data)
      return {
        position: new vec3(obj.px, obj.py, obj.pz),
        rotation: new quat(obj.rw, obj.rx, obj.ry, obj.rz),
      }
    } catch (e) {
      this.logger.error(`Error loading anchor pose: ${e}`)
      return null
    }
  }
}
