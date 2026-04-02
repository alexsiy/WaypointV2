// DistanceDisplayDraggable.js
// Attach to the draggable SceneObject (the object you drag).
// Inspector wiring:
//  - waypointPivot : SceneObject  (the rotationPivot / waypoint center)
//  - labelObject   : SceneObject  (child containing a Component.Text to show dx/dy/dz)
//  - camera        : Component.Camera (main Camera)
// Optional:
//  - showMeters    : boolean (if true, convert units to meters by dividing by 100)
//  - decimals      : int (decimal places to show)

// @input SceneObject waypointPivot
// @input SceneObject labelObject
// @input Component.Camera camera
// @input bool showMeters = false
// @input int decimals = 2

// find the Text component inside labelObject (deep search)
function findTextComp(obj) {
  if (!obj) return null;
  // BFS / recursive: find first Component.Text or Component.Text3D
  for (var i = 0; i < obj.getChildrenCount(); i++) {
    var c = obj.getChild(i);
    var t =
      c.getComponent("Component.Text") || c.getComponent("Component.Text3D");
    if (t) return t;
    var deep = findTextComp(c);
    if (deep) return deep;
  }
  // also check the object itself
  var tSelf =
    obj.getComponent("Component.Text") || obj.getComponent("Component.Text3D");
  if (tSelf) return tSelf;
  return null;
}

var textComp = null;
script.createEvent("OnStartEvent").bind(function () {
  if (!script.labelObject) {
    print("DistanceDisplayDraggable: labelObject not assigned.");
    return;
  }
  textComp = findTextComp(script.labelObject);
  if (!textComp) {
    print(
      "DistanceDisplayDraggable: no Text component found under labelObject.",
    );
  }
});

function formatNumber(v, decimals) {
  var mult = Math.pow(10, decimals || 2);
  return (Math.round(v * mult) / mult).toFixed(decimals || 2);
}

// Update loop: compute delta and update label + billboard it toward camera
script.createEvent("UpdateEvent").bind(function () {
  if (!script.waypointPivot || !script.labelObject) return;
  if (!textComp) return; // can't write text

  // Get world positions
  var myWorldPos = script.getSceneObject().getTransform().getWorldPosition();
  var waypointTransform = script.waypointPivot.getTransform();

  // Convert world position into waypoint local space
  var localPos = waypointTransform
    .getInvertedWorldTransform()
    .multiplyPoint(myWorldPos);

  // Now localPos.x/y/z are what you want
  var dx = localPos.x;
  var dy = localPos.y;
  var dz = localPos.z;

  var distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  var factor = 1.0;
  var unit = "u";
  if (script.showMeters) {
    // if you treat stored units as centimeters, divide by 100 to get meters
    factor = 0.01;
    unit = "m";
  }

  var dec = script.decimals || 2;
  var sx = formatNumber(dx * factor, dec) + " " + unit;
  var sy = formatNumber(dy * factor, dec) + " " + unit;
  var sz = formatNumber(dz * factor, dec) + " " + unit;
  var sd = formatNumber(distance * factor, dec) + " " + unit;

  // Compose multiline label (use \n)
  textComp.text =
    "Δx: " + sx + "\nΔy: " + sy + "\nΔz: " + sz + "\n|dist|: " + sd;

  // Billboard label toward camera so it's always readable
  if (script.camera) {
    var camPos = script.camera.getTransform().getWorldPosition();
    var labelPos = script.labelObject.getTransform().getWorldPosition();
    var dirToCam = camPos.sub(labelPos);
    var L = Math.sqrt(
      dirToCam.x * dirToCam.x +
        dirToCam.y * dirToCam.y +
        dirToCam.z * dirToCam.z,
    );
    if (L > 0.0001) {
      dirToCam = new vec3(dirToCam.x / L, dirToCam.y / L, dirToCam.z / L);
      // Use quat.lookAt (works for text facing)
      var rot = quat.lookAt(dirToCam, vec3.up());
      script.labelObject.getTransform().setWorldRotation(rot);
    }
  }
});
