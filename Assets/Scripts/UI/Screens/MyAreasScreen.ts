import {RectangleButton} from "SpectaclesUIKit.lspkg/Scripts/Components/Button/RectangleButton"
import {Logger} from "Utilities.lspkg/Scripts/Utils/Logger"
import {EventBus} from "../../Shared/EventBus"
import {AppScreen} from "../UIController"
import {SideNavigation} from "../Components/SideNavigation"
import {AreaGridBuilder, AreaInfo} from "../Components/AreaGridBuilder"
import {addButtonLabel} from "../../Shared/ButtonTextHelper"

/**
 * Screen 4: My Areas (Areas Grid)
 * Layout: SideNavigation (left) + dynamic area grid (right)
 */
export class MyAreasScreen {
  private container: SceneObject
  private sideNav: SideNavigation
  private areaGrid: AreaGridBuilder
  private eventBus: EventBus
  private logger: Logger
  private summaryText: Text | null = null

  constructor(parent: SceneObject, eventBus: EventBus, logger: Logger) {
    this.eventBus = eventBus
    this.logger = logger

    this.container = global.scene.createSceneObject("MyAreasScreen")
    this.container.setParent(parent)

    // Side navigation — left area (matching reference)
    this.sideNav = new SideNavigation({
      parent: this.container,
      eventBus,
      logger,
      activeScreen: AppScreen.MyAreas,
    })
    this.sideNav.getContainer().getTransform().setLocalPosition(new vec3(-13.34, 0, 2))

    this.buildHeader()

    // Area grid — right area (dynamic, fills based on created areas)
    this.areaGrid = new AreaGridBuilder({
      parent: this.container,
      eventBus,
      logger,
      columns: 2,
      maxSlots: 6,
      cellSize: new vec2(12.2, 5.25),
    })
    this.areaGrid.getContainer().getTransform().setLocalPosition(new vec3(5.4, -1.05, 2))

    // "Delete All Areas" button below the grid
    this.buildDeleteAllButton()

    this.logger.debug("MyAreasScreen built")
  }

  show(): void {
    this.container.enabled = true
    this.sideNav.setActive(AppScreen.MyAreas)
  }

  hide(): void {
    this.container.enabled = false
  }

  updateAreas(areas: AreaInfo[]): void {
    this.areaGrid.updateAreas(areas)
    if (this.summaryText) {
      const count = areas.filter((area) => area.occupied).length
      this.summaryText.text =
        count === 0
          ? "Name a place, scan it once, then return to its saved route."
          : `${count} saved ${count === 1 ? "area" : "areas"} with persistent route context.`
    }
  }

  setSelectedArea(index: number): void {
    this.areaGrid.setSelected(index)
  }

  private buildDeleteAllButton(): void {
    const btnObj = global.scene.createSceneObject("Btn_DeleteAllAreas")
    btnObj.setParent(this.container)
    btnObj.getTransform().setLocalPosition(new vec3(5.4, -11.0, 2))

    const btn = btnObj.createComponent(RectangleButton.getTypeName()) as RectangleButton
    ;(btn as any)._style = "PrimaryNeutral"
    btn.size = new vec3(13, 3.1, 1)
    btn.renderOrder = 10
    btn.initialize()
    addButtonLabel(btnObj, "Delete All Areas", 13, 3.1, 21)

    btn.onTriggerUp.add(() => {
      this.logger.debug("Delete All Areas pressed")
      this.eventBus.emit("deleteAllAreas")
    })
  }

  private buildHeader(): void {
    const titleObj = global.scene.createSceneObject("MyAreasTitle")
    titleObj.setParent(this.container)
    titleObj.getTransform().setLocalPosition(new vec3(5.4, 9.55, 2))
    const title = titleObj.createComponent("Component.Text") as Text
    title.text = "Saved Areas"
    title.size = 42
    title.worldSpaceRect = Rect.create(-12.5, 12.5, -1.0, 1.0)
    title.horizontalOverflow = HorizontalOverflow.Shrink
    title.verticalOverflow = VerticalOverflow.Shrink
    title.horizontalAlignment = HorizontalAlignment.Center
    title.verticalAlignment = VerticalAlignment.Center
    title.textFill.mode = TextFillMode.Solid
    title.textFill.color = new vec4(1, 1, 1, 1)
    title.renderOrder = 12

    const summaryObj = global.scene.createSceneObject("MyAreasSummary")
    summaryObj.setParent(this.container)
    summaryObj.getTransform().setLocalPosition(new vec3(5.4, 7.85, 2))
    this.summaryText = summaryObj.createComponent("Component.Text") as Text
    this.summaryText.text = "Name a place, scan it once, then return to its saved route."
    this.summaryText.size = 19
    this.summaryText.worldSpaceRect = Rect.create(-12.5, 12.5, -0.75, 0.75)
    this.summaryText.horizontalOverflow = HorizontalOverflow.Wrap
    this.summaryText.verticalOverflow = VerticalOverflow.Shrink
    this.summaryText.horizontalAlignment = HorizontalAlignment.Center
    this.summaryText.verticalAlignment = VerticalAlignment.Center
    this.summaryText.textFill.mode = TextFillMode.Solid
    this.summaryText.textFill.color = new vec4(0.72, 0.95, 1, 0.96)
    this.summaryText.renderOrder = 12
  }

  destroy(): void {
    this.container.destroy()
  }

  getContainer(): SceneObject {
    return this.container
  }
}
