// NewWaypointController.js

// @input SceneObject waypointIconObject
// @input Component.ScriptComponent waypointManagerScript
// @input Component.Camera camera

var spawnedWaypoint = null;

// Call this from your UI button
script.api.startPlacement = function() {
    spawnWaypoint();
};

// Call this from your Confirm button
script.api.confirmPlacement = function() {
    if (!spawnedWaypoint) { return; }

    // Fake anchorId for now (we’ll replace with real anchor later)
    var anchorId = "anchor_" + Date.now();

    var manager = script.waypointManagerScript.api;

    var meta = manager.createWaypointMeta(anchorId, "New Location");
    manager.saveWaypointMeta(meta);

    print("Waypoint saved with id:", anchorId);

    // Hide onboarding UI
    script.getSceneObject().enabled = false;
};

function spawnWaypoint() {
    var camTransform = script.camera.getTransform();
    var forward = camTransform.forward;
    var camPos = camTransform.getWorldPosition();

    var spawnPos = camPos.add(forward.uniformScale(50)); // 50cm in front

    spawnedWaypoint = script.waypointIconObject;
    spawnedWaypoint.enabled = true;
    spawnedWaypoint.getTransform().setWorldPosition(spawnPos);
}