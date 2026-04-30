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
    name: "Community",
    authorLabel: "Community voice",
  },
  {
    id: "expert",
    name: "Expert",
    authorLabel: "Guest expert",
  },
  {
    id: "memory",
    name: "Memory",
    authorLabel: "Personal memory",
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
