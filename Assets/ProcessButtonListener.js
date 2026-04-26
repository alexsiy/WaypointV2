// @input Component.ScriptComponent placementController

script.createEvent("OnStartEvent").bind(function () {
  var button = script
    .getSceneObject()
    .getComponent("Component.ScriptComponent");

  if (!button || !button.onTriggerUp) {
    print("Button trigger not found.");
    return;
  }

  button.onTriggerUp.add(function () {
    if (!script.placementController || !script.placementController.api) {
      print("placementController api missing.");
      return;
    }

    var circuitId = inferCircuitId(script.getSceneObject().name);
    var fn =
      script.placementController.api.loadCircuitById ||
      script.placementController.api.loadDemoProcess;

    if (typeof fn !== "function") {
      print("No route loader available.");
      return;
    }

    print("Starting route circuit: " + circuitId);
    fn(circuitId);
  });
});

function inferCircuitId(buttonName) {
  if (buttonName === "ProcessButton2") {
    return "opening";
  }

  return "closing";
}
