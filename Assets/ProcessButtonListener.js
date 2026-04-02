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
    print("ProcessButton1 pressed");
    if (script.placementController && script.placementController.api) {
      var fn = script.placementController.api.loadDemoProcess;
      if (typeof fn === "function") {
        fn();
      } else {
        print("loadDemoProcess is not a function.");
      }
    } else {
      print("placementController api missing.");
    }
  });
});
