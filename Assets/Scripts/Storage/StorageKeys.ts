/**
 * Centralized storage key constants and helpers for persistent storage.
 */

/** Root prefix for all spatial persistence keys. */
export const STORAGE_PREFIX: string = "SPATIAL_API_KEY"

/** Sub-key for the area name-to-id mapping. */
export const AREAS_KEY: string = "AREAS_KEY"

/** Sub-key for widget transform matrices. */
export const TRANSFORM_KEY: string = "TRANSFORM_KEY"

/** Sub-key for widget type identifiers. */
export const TYPE_KEY: string = "TYPE_KEY"

/** Sub-key for widget serialized content strings. */
export const CONTENT_KEY: string = "CONTENT_KEY"

/** Sub-key for the saved anchor pose (widgetParent world transform). */
export const ANCHOR_POSE_KEY: string = "ANCHOR_POSE_KEY"

/** Sub-key for the last area opened from the home/start flow. */
export const LAST_AREA_KEY: string = "LAST_AREA_KEY"

/** Sub-key for the last selected story/circuit within an area. */
export const LAST_CIRCUIT_KEY: string = "LAST_CIRCUIT_KEY"

/** Sub-key prefix for persisted voice guide sample buffers. */
export const VOICE_NOTE_KEY: string = "VOICE_NOTE_KEY"

/**
 * Returns the storage key prefix scoped to a specific area.
 * @param areaName - The human-readable area/space name.
 * @returns Prefixed key string for that area.
 */
export function areaKey(areaName: string): string {
  return `${STORAGE_PREFIX}_${areaName}`
}

/**
 * Returns the fully-qualified storage key for widget data within an area.
 * @param areaName - The area name.
 * @param subKey - One of TRANSFORM_KEY, TYPE_KEY, or CONTENT_KEY.
 * @returns Fully-qualified storage key.
 */
export function widgetKey(areaName: string, subKey: string): string {
  return `${STORAGE_PREFIX}_${areaName}_${subKey}`
}

/**
 * Returns the storage key for the global areas map.
 * @returns Fully-qualified key for the areas record.
 */
export function areasMapKey(): string {
  return `${STORAGE_PREFIX}_${AREAS_KEY}`
}

/**
 * Returns the storage key for the last opened area.
 * @returns Fully-qualified key for the last area name.
 */
export function lastAreaKey(): string {
  return `${STORAGE_PREFIX}_${LAST_AREA_KEY}`
}

/**
 * Returns the storage key for the last selected circuit within an area.
 * @param areaName - The area name.
 * @returns Fully-qualified key for that area's last circuit index.
 */
export function lastCircuitKey(areaName: string): string {
  return `${STORAGE_PREFIX}_${areaName}_${LAST_CIRCUIT_KEY}`
}

/**
 * Returns the storage key prefix for all voice notes in an area.
 * @param areaName - The area name.
 * @returns Prefix shared by every voice note in that area.
 */
export function voiceNotePrefix(areaName: string): string {
  return `${STORAGE_PREFIX}_${areaName}_${VOICE_NOTE_KEY}`
}

/**
 * Returns the storage key for one persisted voice note sample buffer.
 * @param areaName - The area name.
 * @param voiceId - Stable voice note id stored on the NoteWidget.
 * @returns Fully-qualified key for that voice buffer.
 */
export function voiceNoteKey(areaName: string, voiceId: string): string {
  return `${voiceNotePrefix(areaName)}_${voiceId}`
}
