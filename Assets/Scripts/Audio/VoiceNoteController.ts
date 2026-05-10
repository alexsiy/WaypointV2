import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {StorageController} from "../Storage/StorageController"
import {
  NoteVoiceData,
  NoteVoiceFrameShapeData,
  NoteWidget,
} from "../Widgets/Types/NoteWidget"

const DEFAULT_SAMPLE_RATE = 44100
const DEFAULT_MAX_RECORDING_SECONDS = 20
const MIN_RECORDING_SECONDS = 0.35
const UI_REFRESH_INTERVAL_MS = 250
const PLAYBACK_CHUNK_SIZE = 2048
const PLAYBACK_FINISH_CUSHION_SECONDS = 0.35

export interface VoiceNoteUiState {
  configured: boolean
  recording: boolean
  playing: boolean
  hasVoice: boolean
  durationSec: number
  label: string
  status: string
}

interface VoiceNoteRecordResult {
  success: boolean
  message: string
  data?: NoteVoiceData
}

interface VoiceAudioFrameData {
  audioFrame: any
  audioFrameShape: vec3
}

/**
 * Records short guided-tour voice notes from Spectacles microphone input and
 * plays them through an Audio Output asset. Samples are cached as Float32 frames
 * for runtime playback and persisted as compact PCM16 when storage capacity
 * allows.
 */
export class VoiceNoteController {
  private hostObject: SceneObject
  private storageController: StorageController
  private logger: Logger

  private microphoneAsset: AudioTrackAsset | null
  private audioOutputTrack: AudioTrackAsset | null
  private microphoneControl: MicrophoneAudioProvider | null = null
  private audioOutputProvider: AudioOutputProvider | null = null
  private audioComponent: AudioComponent | null = null
  private audioRoot: SceneObject | null = null

  private sampleRate: number = DEFAULT_SAMPLE_RATE
  private maxRecordingSeconds: number = DEFAULT_MAX_RECORDING_SECONDS
  private setupStatus: string = "Voice setup is initializing."

  private recordingNote: NoteWidget | null = null
  private recordingAreaName: string | null = null
  private recordedFrames: VoiceAudioFrameData[] = []
  private recordedSampleCount: number = 0
  private recordingStartedAtMs: number = 0
  private lastUiRefreshAtMs: number = 0

  private voiceCache: Map<string, VoiceAudioFrameData[]> = new Map()
  private playingNoteIndex: number = -1
  private playbackStartedAt: number = 0
  private playbackDurationSec: number = 0
  private playbackFinishCallback: (() => void) | null = null
  private pendingFinishCallback: (() => void) | null = null
  private pendingFinishNoteIndex: number = -1
  private playbackFrames: VoiceAudioFrameData[] | null = null
  private playbackFrameCursor: number = 0
  private lastPlaybackError: string = ""

  constructor(
    hostObject: SceneObject,
    storageController: StorageController,
    logger: Logger,
    microphoneAsset?: AudioTrackAsset,
    audioOutputTrack?: AudioTrackAsset,
    maxRecordingSeconds?: number
  ) {
    this.hostObject = hostObject
    this.storageController = storageController
    this.logger = logger
    this.microphoneAsset = microphoneAsset ?? null
    this.audioOutputTrack = audioOutputTrack ?? null
    this.maxRecordingSeconds = Math.max(
      3,
      maxRecordingSeconds ?? DEFAULT_MAX_RECORDING_SECONDS
    )
    this.ensureConfigured()
  }

  update(): boolean {
    if (this.pendingFinishCallback) {
      return this.dispatchPendingPlaybackFinish()
    }

    let changed = false

    if (this.recordingNote && this.microphoneControl) {
      changed = this.captureMicrophoneFrame() || changed
      const duration = this.getRecordingDurationSec()
      const now = Date.now()
      if (duration >= this.maxRecordingSeconds) {
        this.stopRecording()
        return true
      }
      if (now - this.lastUiRefreshAtMs >= UI_REFRESH_INTERVAL_MS) {
        this.lastUiRefreshAtMs = now
        changed = true
      }
    }

    if (this.isPlaying()) {
      if (getTime() - this.playbackStartedAt >= this.playbackDurationSec) {
        this.finishPlayback(true)
        changed = true
      }
    }

    return changed
  }

  toggleRecording(note: NoteWidget | null, areaName: string | null): VoiceNoteRecordResult {
    if (this.isRecording()) {
      return this.stopRecording()
    }
    return this.startRecording(note, areaName)
  }

  startRecording(note: NoteWidget | null, areaName: string | null): VoiceNoteRecordResult {
    if (!note || !areaName) {
      return {
        success: false,
        message: "Add a step first, then record its voice guide.",
      }
    }

    if (!this.ensureConfigured() || !this.microphoneControl) {
      return {
        success: false,
        message: this.setupStatus,
      }
    }

    this.stopPlayback(false)
    this.recordingNote = note
    this.recordingAreaName = areaName
    this.recordedFrames = []
    this.recordedSampleCount = 0
    this.recordingStartedAtMs = Date.now()
    this.lastUiRefreshAtMs = 0

    try {
      this.audioComponent?.stop(false)
      this.microphoneControl.sampleRate = this.sampleRate
      this.microphoneControl.start()
      return {
        success: true,
        message: `Recording voice for Step ${this.getStepNumber(note)}.\nTap Stop Voice when finished.`,
      }
    } catch (e) {
      this.recordingNote = null
      this.recordingAreaName = null
      this.setupStatus =
        "Could not start the microphone. Check the Lens Studio preview microphone toggle and Spectacles microphone permission."
      this.logger.error(`Could not start voice recording: ${e}`)
      return {
        success: false,
        message: this.setupStatus,
      }
    }
  }

  stopRecording(): VoiceNoteRecordResult {
    const note = this.recordingNote
    const areaName = this.recordingAreaName

    if (!note || !areaName) {
      return {
        success: false,
        message: "No voice recording is active.",
      }
    }

    try {
      this.microphoneControl?.stop()
    } catch (e) {
      this.logger.warn(`Microphone stop failed: ${e}`)
    }

    const durationSec = this.getRecordingDurationSec()
    const samples = this.flattenRecordedFrames()
    const cachedFrames = this.cloneFrames(this.recordedFrames)
    this.recordingNote = null
    this.recordingAreaName = null
    this.recordedFrames = []
    this.recordedSampleCount = 0

    if (durationSec < MIN_RECORDING_SECONDS || samples.length === 0) {
      return {
        success: false,
        message: "Voice guide was too short. Try recording again.",
      }
    }

    const previousVoice = note.getVoiceNoteData()
    const voiceId = this.createVoiceId()
    const stored = (this.storageController as any).saveVoiceNote(
      areaName,
      voiceId,
      samples
    )
    if (previousVoice && previousVoice.id !== voiceId) {
      this.storageController.deleteVoiceNote(areaName, previousVoice.id)
      this.voiceCache.delete(this.cacheKey(areaName, previousVoice.id))
    }

    this.voiceCache.set(
      this.cacheKey(areaName, voiceId),
      cachedFrames
    )
    const data: NoteVoiceData = {
      id: voiceId,
      durationSec,
      sampleRate: this.sampleRate,
      sampleCount: samples.length,
      storageVersion: 2,
      frameShapes: this.getFrameShapeData(cachedFrames),
      recordedAt: Date.now(),
      stored,
    }
    note.setVoiceNoteData(data)

    return {
      success: true,
      data,
      message:
        `Voice guide saved for Step ${this.getStepNumber(note)} ` +
        `(${this.formatDuration(durationSec)}).`,
    }
  }

  playVoiceForNote(
    note: NoteWidget,
    areaName: string | null,
    onFinished: () => void
  ): boolean {
    if (!areaName || !this.ensureConfigured() || !this.audioOutputProvider || !this.audioComponent) {
      this.lastPlaybackError = this.setupStatus
      return false
    }

    const voice = note.getVoiceNoteData()
    if (!voice) {
      this.lastPlaybackError = "This step does not have a voice guide."
      return false
    }

    const frames = this.getFrames(areaName, voice)
    if (!frames || frames.length === 0) {
      this.lastPlaybackError = "Voice guide audio could not be loaded. Re-record this step."
      return false
    }

    this.stopPlayback(false)
    const playbackSampleRate = this.resolveSampleRate(voice.sampleRate)
    const playbackSampleCount = this.getFrameSampleCount(frames)
    this.audioOutputProvider.sampleRate = playbackSampleRate
    this.audioComponent.audioTrack = this.audioOutputTrack
    this.playingNoteIndex = note.widgetIndex
    this.playbackStartedAt = 0
    this.playbackDurationSec = Math.max(
      0.1,
      playbackSampleCount > 0
        ? playbackSampleCount / playbackSampleRate + PLAYBACK_FINISH_CUSHION_SECONDS
        : voice.durationSec
    )
    this.playbackFinishCallback = onFinished
    this.playbackFrames = frames
    this.playbackFrameCursor = 0

    try {
      this.audioComponent.stop(false)
      this.audioComponent.play(-1)
      if (!this.enqueueAllPlaybackFrames()) {
        this.lastPlaybackError = "Voice guide audio was empty. Re-record this step."
        this.finishPlayback(false)
        return false
      }
    } catch (e) {
      this.lastPlaybackError = "Voice playback failed. Check the Audio Output asset."
      this.logger.error(`Voice playback failed: ${e}`)
      this.stopPlayback(false)
      return false
    }

    this.playbackStartedAt = getTime()
    this.lastPlaybackError = ""
    return true
  }

  stopPlayback(callFinished: boolean): void {
    if (!callFinished) {
      this.pendingFinishCallback = null
      this.pendingFinishNoteIndex = -1
    }
    if (!this.isPlaying()) return
    this.finishPlayback(callFinished)
  }

  isRecording(): boolean {
    return this.recordingNote !== null
  }

  isPlaying(): boolean {
    return this.playingNoteIndex >= 0
  }

  isPlayingForNote(note: NoteWidget): boolean {
    return (
      this.playingNoteIndex === note.widgetIndex ||
      this.pendingFinishNoteIndex === note.widgetIndex
    )
  }

  hasPlayableVoice(note: NoteWidget, areaName: string | null): boolean {
    if (!areaName) return false
    const voice = note.getVoiceNoteData()
    if (!voice) return false
    const key = this.cacheKey(areaName, voice.id)
    const playable = this.voiceCache.has(key) || voice.stored === true
    if (!playable) {
      this.lastPlaybackError = "Voice guide audio is not available. Re-record this step."
    }
    return playable
  }

  getPlaybackRemainingSeconds(): number {
    if (!this.isPlaying()) return 0
    const elapsed = getTime() - this.playbackStartedAt
    return Math.max(0, this.playbackDurationSec - elapsed)
  }

  getLastPlaybackError(): string {
    return this.lastPlaybackError
  }

  getUiState(note: NoteWidget | null, areaName: string | null): VoiceNoteUiState {
    const configured = this.ensureConfigured()
    const recording = this.isRecording()
    const playing = this.isPlaying()
    const hasVoice = !!note?.getVoiceNoteData()
    const voice = note?.getVoiceNoteData() ?? null
    const durationSec = recording
      ? this.getRecordingDurationSec()
      : voice?.durationSec ?? 0

    if (!note) {
      return {
        configured,
        recording,
        playing,
        hasVoice: false,
        durationSec: 0,
        label: "Voice",
        status: "Add a step first, then record an optional voice guide.",
      }
    }

    if (!configured) {
      return {
        configured,
        recording,
        playing,
        hasVoice,
        durationSec,
        label: "Voice",
        status: this.setupStatus,
      }
    }

    if (recording && this.recordingNote?.widgetIndex === note.widgetIndex) {
      return {
        configured,
        recording,
        playing,
        hasVoice,
        durationSec,
        label: "Stop Voice",
        status:
          `Recording Step ${this.getStepNumber(note)} · ` +
          `${this.formatDuration(durationSec)} / ${this.formatDuration(this.maxRecordingSeconds)}`,
      }
    }

    if (hasVoice) {
      const playable = this.hasPlayableVoice(note, areaName)
      return {
        configured,
        recording,
        playing,
        hasVoice,
        durationSec,
        label: "Replace Voice",
        status: playable
          ? `Voice guide ready · ${this.formatDuration(durationSec)}`
          : "Voice guide metadata found, but audio needs to be re-recorded.",
      }
    }

    return {
      configured,
      recording,
      playing,
      hasVoice,
      durationSec,
      label: "Record Voice",
      status: "Optional: record a short guide for this stop.",
    }
  }

  private ensureConfigured(): boolean {
    if (this.microphoneControl && this.audioOutputProvider && this.audioComponent) {
      this.setupStatus = "Voice setup ready."
      return true
    }

    // Inspector references are preferred because they let Lens Studio declare
    // Spectacles microphone permission before runtime. Dynamic loading is only
    // a resilience fallback for local editor sessions.
    if (!this.microphoneAsset) {
      this.microphoneAsset = this.tryLoadAudioTrack([
        "Audio/Microphone.micaudio",
        "Assets/Audio/Microphone.micaudio",
        "../Audio/Microphone.micaudio",
      ])
    }

    if (!this.audioOutputTrack) {
      this.audioOutputTrack = this.tryLoadAudioTrack([
        "Audio/AudioOutput.audioOutput",
        "Assets/Audio/AudioOutput.audioOutput",
        "../Audio/AudioOutput.audioOutput",
      ])
    }

    if (!this.microphoneAsset || !this.audioOutputTrack) {
      if (!this.microphoneAsset && !this.audioOutputTrack) {
        this.setupStatus =
          "Voice setup needs the Microphone and Audio Output assets wired on AppController."
      } else if (!this.microphoneAsset) {
        this.setupStatus =
          "Voice setup needs the Audio From Microphone asset wired on AppController."
      } else {
        this.setupStatus =
          "Voice setup needs the Audio Output asset wired on AppController."
      }
      return false
    }

    if (!this.audioRoot) {
      this.audioRoot = global.scene.createSceneObject("VoiceNoteAudioRuntime")
      this.audioRoot.setParent(this.hostObject)
    }

    if (!this.audioComponent) {
      this.audioComponent = this.audioRoot.createComponent("AudioComponent") as AudioComponent
      this.audioComponent.audioTrack = this.audioOutputTrack
    }

    try {
      this.microphoneControl = this.microphoneAsset.control as MicrophoneAudioProvider
      this.audioOutputProvider = this.audioOutputTrack.control as AudioOutputProvider
      this.microphoneControl.sampleRate = this.sampleRate
      this.audioOutputProvider.sampleRate = this.sampleRate
      this.setupStatus = "Voice setup ready."
      return true
    } catch (e) {
      this.setupStatus = "Voice audio setup failed. Re-open the project or reselect the voice audio assets."
      this.logger.error(`Voice audio setup failed: ${e}`)
      return false
    }
  }

  private tryLoadAudioTrack(candidates: string[]): AudioTrackAsset | null {
    for (let i = 0; i < candidates.length; i++) {
      try {
        const asset = requireAsset(candidates[i]) as AudioTrackAsset
        if (asset) return asset
      } catch (_e) {
        // Try the next project-relative path.
      }
    }
    return null
  }

  private captureMicrophoneFrame(): boolean {
    if (!this.microphoneControl) return false

    const frameSize = Math.max(1, this.microphoneControl.maxFrameSize)
    let audioFrame = new Float32Array(frameSize)
    const audioShape = (this.microphoneControl as any).getAudioFrame(audioFrame)
    const sampleCount = Math.max(0, Math.min(audioShape.x, audioFrame.length))
    if (sampleCount === 0) return false

    audioFrame = audioFrame.subarray(0, sampleCount)
    const copy = new Float32Array(sampleCount)
    copy.set(audioFrame)
    this.recordedFrames.push({
      audioFrame: copy,
      audioFrameShape: new vec3(
        sampleCount,
        audioShape.y > 0 ? audioShape.y : 1,
        audioShape.z > 0 ? audioShape.z : 1
      ),
    })
    this.recordedSampleCount += sampleCount
    return true
  }

  private flattenRecordedFrames(): Float32Array {
    const result = new Float32Array(this.recordedSampleCount)
    let offset = 0
    for (const frame of this.recordedFrames) {
      result.set(frame.audioFrame, offset)
      offset += frame.audioFrame.length
    }
    return result
  }

  private enqueueAllPlaybackFrames(): boolean {
    if (!this.audioOutputProvider || !this.playbackFrames) return false

    let queuedSamples = 0
    for (let i = 0; i < this.playbackFrames.length; i++) {
      const frame = this.playbackFrames[i]
      this.audioOutputProvider.enqueueAudioFrame(
        frame.audioFrame,
        frame.audioFrameShape
      )
      queuedSamples += Math.max(1, Math.floor(frame.audioFrameShape.x))
    }

    this.playbackFrameCursor = this.playbackFrames.length
    return queuedSamples > 0
  }

  private getFrames(
    areaName: string,
    voice: NoteVoiceData
  ): VoiceAudioFrameData[] | null {
    const key = this.cacheKey(areaName, voice.id)
    const cached = this.voiceCache.get(key)
    if (cached && cached.length > 0) return cached

    if (!voice.stored) return null

    const loaded = (this.storageController as any).loadVoiceNote(areaName, voice.id)
    const samples = this.normalizeStoredSamples(loaded)
    if (samples && samples.length > 0) {
      const expectedCount = Math.max(0, Math.floor(voice.sampleCount ?? 0))
      if (
        expectedCount > 0 &&
        Math.abs(samples.length - expectedCount) > Math.max(4, expectedCount * 0.01)
      ) {
        this.lastPlaybackError =
          "Voice guide storage did not match this step. Re-record this voice guide."
        this.logger.warn(
          `Voice note "${voice.id}" sample count mismatch: ` +
            `expected ${expectedCount}, got ${samples.length}`
        )
        return null
      }
      const frames = this.createFramesFromSamples(
        samples,
        voice.frameSizes,
        voice.frameShapes
      )
      this.voiceCache.set(key, frames)
      return frames
    }
    return null
  }

  private normalizeStoredSamples(samples: any): Float32Array | null {
    if (!samples || samples.length === 0) return null
    if (samples instanceof Float32Array) {
      return samples
    }
    if (samples instanceof Int16Array) {
      const converted = new Float32Array(samples.length)
      for (let i = 0; i < samples.length; i++) {
        converted[i] = samples[i] / 32768.0
      }
      return converted
    }
    return samples as Float32Array
  }

  private createFramesFromSamples(
    samples: Float32Array,
    frameSizes?: number[],
    frameShapes?: NoteVoiceFrameShapeData[]
  ): VoiceAudioFrameData[] {
    const frames: VoiceAudioFrameData[] = []
    let offset = 0
    if (frameShapes && frameShapes.length > 0) {
      for (const shape of frameShapes) {
        const size = Math.max(0, Math.floor(shape.x))
        if (size <= 0 || offset >= samples.length) continue
        const count = Math.min(size, samples.length - offset)
        frames.push(this.createAudioFrame(samples, offset, count, shape))
        offset += count
      }
    } else if (frameSizes && frameSizes.length > 0) {
      for (const rawSize of frameSizes) {
        const size = Math.max(0, Math.floor(rawSize))
        if (size <= 0 || offset >= samples.length) continue
        const count = Math.min(size, samples.length - offset)
        frames.push(this.createAudioFrame(samples, offset, count))
        offset += count
      }
    }

    while (offset < samples.length) {
      const count = Math.min(PLAYBACK_CHUNK_SIZE, samples.length - offset)
      frames.push(this.createAudioFrame(samples, offset, count))
      offset += count
    }

    return frames
  }

  private createAudioFrame(
    samples: Float32Array,
    offset: number,
    count: number,
    shape?: NoteVoiceFrameShapeData
  ): VoiceAudioFrameData {
    const audioFrame = new Float32Array(count)
    audioFrame.set(samples.subarray(offset, offset + count))
    return {
      audioFrame,
      audioFrameShape: new vec3(
        count,
        shape && shape.y > 0 ? shape.y : 1,
        shape && shape.z > 0 ? shape.z : 1
      ),
    }
  }

  private cloneFrames(frames: VoiceAudioFrameData[]): VoiceAudioFrameData[] {
    const clones: VoiceAudioFrameData[] = []
    for (const frame of frames) {
      const sampleCount = Math.max(0, Math.floor(frame.audioFrameShape.x))
      if (sampleCount <= 0) continue
      const source = frame.audioFrame as Float32Array
      const copy = new Float32Array(sampleCount)
      copy.set(source.subarray(0, sampleCount))
      clones.push({
        audioFrame: copy,
        audioFrameShape: new vec3(
          sampleCount,
          frame.audioFrameShape.y > 0 ? frame.audioFrameShape.y : 1,
          frame.audioFrameShape.z > 0 ? frame.audioFrameShape.z : 1
        ),
      })
    }
    return clones
  }

  private getFrameShapeData(frames: VoiceAudioFrameData[]): NoteVoiceFrameShapeData[] {
    const shapes: NoteVoiceFrameShapeData[] = []
    for (const frame of frames) {
      shapes.push(this.shapeToData(frame.audioFrameShape))
    }
    return shapes
  }

  private shapeToData(shape: vec3): NoteVoiceFrameShapeData {
    return {
      x: Math.max(0, Math.floor(shape.x)),
      y: shape.y > 0 ? shape.y : 1,
      z: shape.z > 0 ? shape.z : 1,
    }
  }

  private createVoiceId(): string {
    const time = Date.now().toString(36)
    const random = Math.floor(Math.random() * 0x7fffffff).toString(36)
    return `voice_${time}_${random}`
  }

  private resolveSampleRate(sampleRate: number | undefined): number {
    const resolved = Math.floor(sampleRate ?? 0)
    return resolved > 0 ? resolved : this.sampleRate
  }

  private getFrameSampleCount(frames: VoiceAudioFrameData[]): number {
    let total = 0
    for (const frame of frames) {
      total += Math.max(0, Math.floor(frame.audioFrameShape.x))
    }
    return total
  }

  private finishPlayback(callFinished: boolean): void {
    const callback = this.playbackFinishCallback
    const finishedNoteIndex = this.playingNoteIndex
    this.playbackFinishCallback = null
    this.playingNoteIndex = -1
    this.playbackStartedAt = 0
    this.playbackDurationSec = 0
    this.playbackFrames = null
    this.playbackFrameCursor = 0

    try {
      this.audioComponent?.stop(false)
    } catch (_e) {
      // Playback may already be stopped by Lens Studio.
    }

    if (callFinished && callback && !this.pendingFinishCallback) {
      this.pendingFinishCallback = callback
      this.pendingFinishNoteIndex = finishedNoteIndex
    }
  }

  private dispatchPendingPlaybackFinish(): boolean {
    const callback = this.pendingFinishCallback
    this.pendingFinishCallback = null
    this.pendingFinishNoteIndex = -1

    if (!callback) return false

    try {
      callback()
    } catch (e) {
      this.logger.error(`Voice finish callback failed: ${e}`)
    }

    return true
  }

  private getRecordingDurationSec(): number {
    if (this.recordedSampleCount > 0) {
      return this.recordedSampleCount / this.sampleRate
    }
    if (this.recordingStartedAtMs <= 0) return 0
    return Math.max(0, (Date.now() - this.recordingStartedAtMs) / 1000)
  }

  private getStepNumber(note: NoteWidget): number {
    const meta = note.getCircuitStep()
    return meta ? meta.stepIndex + 1 : note.widgetIndex + 1
  }

  private cacheKey(areaName: string, voiceId: string): string {
    return `${areaName}:${voiceId}`
  }

  private formatDuration(seconds: number): string {
    return `${Math.max(0, seconds).toFixed(1)}s`
  }
}
