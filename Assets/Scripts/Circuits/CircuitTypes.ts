export interface CircuitVec3Data {
  x: number
  y: number
  z: number
}

export interface CircuitStepMeta {
  circuitId: string
  circuitName: string
  stepIndex: number
  triggerPosition: CircuitVec3Data
  authoredAt: number
  authorLabel: string
}

export interface CircuitDefinition {
  id: string
  name: string
  authorLabel: string
}

export const DEFAULT_CIRCUITS: CircuitDefinition[] = [
  {
    id: "community",
    name: "Story 1",
    authorLabel: "Story 1 voice",
  },
  {
    id: "expert",
    name: "Story 2",
    authorLabel: "Story 2 voice",
  },
  {
    id: "memory",
    name: "Story 3",
    authorLabel: "Story 3 voice",
  },
]

export function vec3ToCircuitData(value: vec3): CircuitVec3Data {
  return {
    x: value.x,
    y: value.y,
    z: value.z,
  }
}

export function circuitDataToVec3(value: CircuitVec3Data): vec3 {
  return new vec3(value.x, value.y, value.z)
}
