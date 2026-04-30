import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {WidgetBase} from "../WidgetBase"

interface PhotoData {
  caption: string
}

/**
 * Photo Widget — visual marker for route evidence and future image attachments.
 * Wire the Image child in the inspector. Frame is added manually on the prefab.
 */
@component
export class PhotoWidget extends WidgetBase {
  @ui.label(
    '<span style="color: #60A5FA;">PhotoWidget – Photo display</span>'
  )
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @input
  @hint("Image component for photo display")
  photoImage: Image

  @ui.separator
  @ui.label('<span style="color: #60A5FA;">Logging</span>')
  @input
  @hint("Enable general logging")
  enableLogging: boolean = false

  @input
  @hint("Enable lifecycle logging")
  enableLoggingLifecycle: boolean = false

  private captionText: Text | null = null
  private caption: string = "Visual marker"

  onAwake(): void {
    super.onAwake()
    this.logger = new Logger(
      "PhotoWidget",
      this.enableLogging || this.enableLoggingLifecycle,
      true
    )
    this.applyCompactLayout()
    this.logger.debug("PhotoWidget initialized")
  }

  get serializedContent(): string {
    const data: PhotoData = {caption: this.caption}
    return JSON.stringify(data)
  }

  set serializedContent(value: string) {
    try {
      const data: PhotoData = JSON.parse(value)
      this.caption = data.caption ?? this.caption
      this.updateCaption()
    } catch (e) {
      this.logger.warn("serializedContent parse error: " + e)
    }
  }

  applyCompactLayout(): void {
    if (this.photoImage) {
      this.photoImage.getSceneObject().getTransform().setLocalPosition(
        new vec3(0, 0.7, 0.12)
      )
      this.photoImage.getSceneObject().getTransform().setLocalScale(new vec3(8, 8, 8))
      this.photoImage.renderOrder = 10
    }

    this.ensureCaption()
    this.updateCaption()
  }

  private ensureCaption(): void {
    if (this.captionText) return
    const captionObj = global.scene.createSceneObject("PhotoCaption")
    captionObj.setParent(this.getSceneObject())
    captionObj.getTransform().setLocalPosition(new vec3(0, -5.2, 0.14))

    this.captionText = captionObj.createComponent("Component.Text") as Text
    this.captionText.size = 18
    this.captionText.worldSpaceRect = Rect.create(-6, 6, -1, 1)
    this.captionText.horizontalOverflow = HorizontalOverflow.Shrink
    this.captionText.verticalOverflow = VerticalOverflow.Overflow
    this.captionText.horizontalAlignment = HorizontalAlignment.Center
    this.captionText.verticalAlignment = VerticalAlignment.Center
    this.captionText.textFill.mode = TextFillMode.Solid
    this.captionText.textFill.color = new vec4(1, 1, 1, 0.9)
    this.captionText.renderOrder = 10
  }

  private updateCaption(): void {
    if (this.captionText) {
      this.captionText.text = this.caption
    }
  }
}
