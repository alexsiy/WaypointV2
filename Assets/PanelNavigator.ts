import { BaseButton } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/BaseButton";

// Component decorator - marks this class as a Lens Studio component that can be attached to scene objects
@component
export class PanelNavigator extends BaseScriptComponent {
  // @input decorator - creates an editable field in the Lens Studio Inspector

  // Reference to the first panel (select location UI)
  @input
  IntroPanel: SceneObject | undefined;

  @input
  placementController: ScriptComponent | undefined;

  @input
  SelectLocationPanel: SceneObject | undefined;

  // Reference to the second panel (new location UI)
  @input
  NewLocationPanel: SceneObject | undefined;

  // Reference to the third panel (select process UI)
  @input
  SelectProcessPanel: SceneObject | undefined;

  @input
  NewProcessPanel: SceneObject | undefined;

  @input
  LocationRadiusCircle: SceneObject | undefined;

  @input
  FinishProcessCreationPanel: SceneObject | undefined;

  @input
  RunProcessPanel: SceneObject | undefined;

  @input
  startBtn: BaseButton | undefined;

  // Reference to the first "Next" button (navigates from select location panel to new location panel)
  @input
  addLocationBtn: BaseButton | undefined;

  @input
  skipToProcessBtn: BaseButton | undefined;

  // Reference to the second "Next" button (navigates from new location panel to select process panel)
  @input
  nextBtn: BaseButton | undefined;

  @input
  newProcessBtn: BaseButton | undefined;

  @input
  allStepsCreatedBtn: BaseButton | undefined;

  @input
  finishProcessCreationBtn: BaseButton | undefined;

  @input
  runProcessBtn: BaseButton | undefined;

  // Lifecycle method - called when the component wakes up
  onAwake() {
    // Create an event listener that triggers when the lens starts
    this.createEvent("OnStartEvent").bind(() => {
      this.onStart();
    });
  }

  // Initialization method - runs once when the lens starts
  onStart() {
    // Log debug information to verify component setup
    print("=== PanelNavigator Starting ===");
    print("IntroPanel assigned: " + (this.IntroPanel !== undefined));
    print(
      "SelectLocationPanel assigned: " +
        (this.SelectLocationPanel !== undefined),
    );
    print(
      "NewLocationPanel assigned: " + (this.NewLocationPanel !== undefined),
    );
    print(
      "SelectProcessPanel assigned: " + (this.SelectProcessPanel !== undefined),
    );
    print("NewProcessPanel assigned: " + (this.NewProcessPanel !== undefined));
    print(
      "LocationRadiusCircle assigned: " +
        (this.LocationRadiusCircle !== undefined),
    );
    print(
      "FinishProcessCreationPanel assigned: " +
        (this.FinishProcessCreationPanel !== undefined),
    );
    print("RunProcessPanel assigned: " + (this.RunProcessPanel !== undefined));

    // Hide all panels to start with a clean slate
    this.hideAllPanels();

    // Make the first panel (select location) visible as the starting panel
    if (this.IntroPanel) {
      this.IntroPanel.enabled = true;
      print("IntroPanel is now visible");
    }

    // Set up the first navigation button
    // When pressed, this button moves from the select location panel to the new location panel
    if (this.startBtn) {
      print("startBtn connected");
      this.startBtn.onTriggerUp.add(() => {
        print("startBtn pressed - switching to SelectLocationPanel");
        this.switchToSelectLocationPanel();
      });
    } else {
      print("WARNING: startBtn is not assigned!");
    }

    if (this.addLocationBtn) {
      print("addLocationBtn connected");
      this.addLocationBtn.onTriggerUp.add(() => {
        print("addLocationBtn pressed - switching to NewLocationPanel");
        this.switchToNewLocationPanel();
      });
    } else {
      print("WARNING: addLocationBtn is not assigned!");
    }

    if (this.skipToProcessBtn) {
      print("skipToProcessBtn connected");
      this.skipToProcessBtn.onTriggerUp.add(() => {
        print("skipToProcessBtn pressed - switching to SelectProcessPanel");
        this.switchToSelectProcessPanel();
      });
    } else {
      print("WARNING: skipToProcessBtn is not assigned!");
    }

    // Set up the second navigation button
    // When pressed, this button moves from the new location panel to the select process panel
    if (this.nextBtn) {
      print("nextBtn connected");
      this.nextBtn.onTriggerUp.add(() => {
        print("nextBtn pressed - switching to SelectProcessPanel");
        this.switchToSelectProcessPanel();
      });
    } else {
      print("WARNING: nextBtn is not assigned!");
    }

    if (this.newProcessBtn) {
      print("newProcessBtn connected");
      this.newProcessBtn.onTriggerUp.add(() => {
        print("newProcessBtn pressed - switching to NewProcessPanel");
        this.switchToNewProcessPanel();
      });
    } else {
      print("WARNING: newProcessBtn is not assigned!");
    }

    if (this.runProcessBtn) {
      print("runProcessBtn connected");
      this.runProcessBtn.onTriggerUp.add(() => {
        print("runProcessBtn pressed - switching to RunProcessPanel");
        this.switchToRunProcessPanel();
      });
    } else {
      print("WARNING: runProcessBtn is not assigned!");
    }

    if (this.allStepsCreatedBtn) {
      print("allStepsCreatedBtn connected");
      this.allStepsCreatedBtn.onTriggerUp.add(() => {
        print("allStepsCreatedBtn pressed - switching to RunProcessPanel");
        this.switchToFinishProcessCreationPanel();
      });
    } else {
      print("WARNING: allStepsCreatedBtn is not assigned!");
    }

    if (this.finishProcessCreationBtn) {
      print("finishProcessCreationBtn connected");
      this.finishProcessCreationBtn.onTriggerUp.add(() => {
        print(
          "finishProcessCreationBtn pressed - switching to RunProcessPanel",
        );
        this.switchToSelectProcessPanel();
      });
    } else {
      print("WARNING: finishProcessCreationBtn is not assigned!");
    }
  }

  // Helper method to hide all three panels
  // This ensures only one panel is visible at a time
  hideAllPanels() {
    print("hideAllPanels called");
    if (this.IntroPanel) {
      this.IntroPanel.enabled = false;
      print("  - IntroPanel disabled");
    }

    // Disable (hide) the select location panel
    if (this.SelectLocationPanel) {
      this.SelectLocationPanel.enabled = false;
      print("  - SelectLocationPanel disabled");
    }
    // Disable (hide) the new location panel
    if (this.NewLocationPanel) {
      this.NewLocationPanel.enabled = false;
      print("  - NewLocationPanel disabled");
    }
    // Disable (hide) the select process panel
    if (this.SelectProcessPanel) {
      this.SelectProcessPanel.enabled = false;
      print("  - SelectProcessPanel disabled");
    }

    if (this.NewProcessPanel) {
      this.NewProcessPanel.enabled = false;
      print("  - NewProcessPanel disabled");
    }

    if (this.LocationRadiusCircle) {
      this.LocationRadiusCircle.enabled = false;
      print("  - LocationRadiusCircle disabled");
    }

    if (this.RunProcessPanel) {
      this.RunProcessPanel.enabled = false;
      print("  - RunProcessPanel disabled");
    }

    if (this.FinishProcessCreationPanel) {
      this.FinishProcessCreationPanel.enabled = false;
      print("  - FinishProcessCreationPanel disabled");
    }
  }

  switchToSelectLocationPanel() {
    print("Switching to SelectLocationPanel...");
    // First hide all panels
    this.hideAllPanels();

    if (this.SelectLocationPanel) {
      this.SelectLocationPanel.enabled = true;
      print("SelectLocationPanel enabled: " + this.SelectLocationPanel.enabled);
    } else {
      print("ERROR: SelectLocationPanel is undefined!");
    }
  }

  switchToNewLocationPanel() {
    print("Switching to NewLocationPanel...");
    // First hide all panels
    this.hideAllPanels();

    if (this.NewLocationPanel) {
      this.NewLocationPanel.enabled = true;

      // call placement controller if assigned
      if (
        this.placementController &&
        this.placementController.api &&
        typeof this.placementController.api.startNewLocationPlacement ===
          "function"
      ) {
        this.placementController.api.startNewLocationPlacement();
      }
      print("NewLocationPanel enabled: " + this.NewLocationPanel.enabled);
    } else {
      print("ERROR: NewLocationPanel is undefined!");
    }
  }

  // Navigation method to switch to the select process panel
  switchToSelectProcessPanel() {
    print("Switching to SelectProcessPanel...");

    // Hide all panels first
    this.hideAllPanels();

    // Then enable (show) only the select proces panel
    if (this.SelectProcessPanel) {
      this.SelectProcessPanel.enabled = true;

      // call placement controller if assigned
      if (
        this.placementController &&
        this.placementController.api &&
        typeof this.placementController.api.startNewLocationPlacement ===
          "function"
      ) {
        this.placementController.api.startNewLocationPlacement();
      }

      // after enabling SelectProcess panel
      this.SelectProcessPanel.enabled = true;

      if (
        this.placementController &&
        this.placementController.api &&
        typeof this.placementController.api.startSelectLocationPlacement ===
          "function"
      ) {
        this.placementController.api.startSelectLocationPlacement();
      }

      print("SelectProcessPanel enabled: " + this.SelectProcessPanel.enabled);
      print("SelectProcessPanel name: " + this.SelectProcessPanel.name);
    } else {
      print("ERROR: SelectProcessPanel is undefined!");
    }
  }

  switchToNewProcessPanel() {
    print("Switching to NewProcessPanel...");

    // Hide all panels first
    this.hideAllPanels();

    if (this.NewProcessPanel) {
      this.NewProcessPanel.enabled = true;
      this.LocationRadiusCircle.enabled = true;
      print("NewProcessPanel enabled: " + this.NewProcessPanel.enabled);
      print("NewProcessPanel name: " + this.NewProcessPanel.name);
    } else {
      print("ERROR: NewProcessPanel is undefined!");
    }
  }

  switchToRunProcessPanel() {
    print("Switching to RunProcessPanel...");

    // Hide all panels first
    this.hideAllPanels();

    if (this.RunProcessPanel) {
      this.RunProcessPanel.enabled = true;
      print("RunProcessPanel enabled: " + this.RunProcessPanel.enabled);
      print("RunProcessPanel name: " + this.RunProcessPanel.name);
    } else {
      print("ERROR: RunProcessPanel is undefined!");
    }
  }

  switchToFinishProcessCreationPanel() {
    print("Switching to FinishProcessCreationPanel...");

    // Hide all panels first
    this.hideAllPanels();

    if (this.FinishProcessCreationPanel) {
      this.FinishProcessCreationPanel.enabled = true;
      print(
        "FinishProcessCreationPanel enabled: " +
          this.FinishProcessCreationPanel.enabled,
      );
      print(
        "FinishProcessCreationPanel name: " +
          this.FinishProcessCreationPanel.name,
      );
    } else {
      print("ERROR: FinishProcessCreationPanel is undefined!");
    }
  }
}
