// @input SceneObject waypointObject
// @input Component.Camera camera
// @input Component.ScriptComponent rotationSlider        // NewLocation slider
// @input Component.ScriptComponent selectRotationSlider  // SelectProcess slider
// @input float spawnDistance = 30
// @input SceneObject rotationPivot
// @input Asset.ObjectPrefab lineSegmentPrefab
// @input SceneObject lineParent

// @input SceneObject[] stepObjects   // drag Step1, Step2, Step3 here

var currentMode = "none"; // "new" or "select"

script.createEvent("OnStartEvent").bind(function () {
  script.waypointObject.enabled = false;
  connectSliders();
});

// PUBLIC ENTRY POINTS
script.api.startNewLocationPlacement = function () {
  currentMode = "new";
  spawnInFrontOfCamera();
};

script.api.startSelectLocationPlacement = function () {
  currentMode = "select";
  spawnInFrontOfCamera();
};

script.createEvent("OnDisableEvent").bind(function () {
  script.waypointObject.enabled = false;
});

function spawnInFrontOfCamera() {
  var camTransform = script.camera.getTransform();
  var camPos = camTransform.getWorldPosition();

  var spawnPos = camPos.add(new vec3(0, 0, -script.spawnDistance));

  script.waypointObject.enabled = true;
  script.waypointObject.getTransform().setWorldPosition(spawnPos);
}

function connectSliders() {
  var delayed = script.createEvent("DelayedCallbackEvent");

  delayed.bind(function () {
    if (script.rotationSlider && script.rotationSlider.onValueChange) {
      script.rotationSlider.onValueChange.add(function (value) {
        if (currentMode === "new") {
          applyRotation(value);
        }
      });
    }

    if (
      script.selectRotationSlider &&
      script.selectRotationSlider.onValueChange
    ) {
      script.selectRotationSlider.onValueChange.add(function (value) {
        if (currentMode === "select") {
          applyRotation(value);
        }
      });
    }

    print("Sliders connected");
  });

  delayed.reset(0);
}

function applyRotation(value) {
  var angle = value * Math.PI * 2;
  var rotation = quat.angleAxis(angle, vec3.up());

  script.rotationPivot.getTransform().setLocalRotation(rotation);
}

script.api.loadDemoProcess = function () {
  print("loadDemoProcess ENTERED");

  var store = global.persistentStorageSystem.store;
  var jsonString = store.getString("demoProcess");

  if (!jsonString) {
    print("No demo process found.");
    return;
  }

  var process = JSON.parse(jsonString);

  for (var i = 0; i < process.steps.length; i++) {
    var stepData = process.steps[i];
    var stepObject = script.stepObjects[i];

    if (!stepObject) continue;

    stepObject.enabled = true;

    // Place relative to rotationPivot
    print(
      "Applying local position: " +
        stepData.x +
        ", " +
        stepData.y +
        ", " +
        stepData.z,
    );
    stepObject
      .getTransform()
      .setLocalPosition(new vec3(stepData.x, stepData.y, stepData.z));

    // Set step text (assumes child text component)
    // Find Text component inside step object
    var textComponent = null;

    // Loop through Step1 children
    for (var c = 0; c < stepObject.getChildrenCount(); c++) {
      var child = stepObject.getChild(c);

      // Look inside TextPanel
      if (child.name === "TextPanel") {
        for (var j = 0; j < child.getChildrenCount(); j++) {
          var grandChild = child.getChild(j);

          if (grandChild.name === "Text") {
            textComponent = grandChild.getComponent("Component.Text");
            break;
          }
        }
      }
    }

    if (textComponent) {
      textComponent.text = stepData.name;
      print("Updated text to: " + stepData.name);
    } else {
      print("Text component not found.");
    }
  }

  updateStepLine(process.steps.length);

  print("Demo process loaded.");
};

script.createEvent("OnStartEvent").bind(function () {
  script.waypointObject.enabled = false;

  // Hide all step objects
  for (var i = 0; i < script.stepObjects.length; i++) {
    if (script.stepObjects[i]) {
      script.stepObjects[i].enabled = false;
    }
  }

  connectSliders();
});

function updateStepLine(processStepsCount) {
  // Clear previous segments
  if (!script.lineParent || !script.lineSegmentPrefab) {
    print("No lineParent or prefab assigned.");
    return;
  }
  for (var k = script.lineParent.getChildrenCount() - 1; k >= 0; k--) {
    script.lineParent.getChild(k).destroy();
  }

  // Build ordered world positions list: waypoint first, then steps
  var worldPoints = [];

  // waypoint world position (use whichever object defines the waypoint center)
  var waypointPos = script.rotationPivot.getTransform().getWorldPosition();
  worldPoints.push(waypointPos);

  // add available steps (guard against missing inspector entries)
  for (var i = 0; i < processStepsCount; i++) {
    var stepObject = script.stepObjects && script.stepObjects[i];
    if (!stepObject) {
      print("Skipping missing step object index:", i);
      continue;
    }
    worldPoints.push(stepObject.getTransform().getWorldPosition());
  }

  if (worldPoints.length < 2) {
    // nothing to draw
    return;
  }

  // CURVE SETTINGS (tweak to taste)
  var subdivisionsPerSegment = 6; // more -> smoother curve (costlier)
  var curveHeightMultiplier = 0.12; // fraction of segment length used as upward lift
  var meanderFactor = 0.06; // fraction of length used for sideways meander

  var sampled = buildCurvedPoints(
    worldPoints,
    subdivisionsPerSegment,
    curveHeightMultiplier,
    meanderFactor,
  );

  // create cylinder segments between consecutive sampled points
  for (var j = 0; j < sampled.length - 1; j++) {
    var pA = sampled[j];
    var pB = sampled[j + 1];

    // quick guard for degenerate points
    var dir = subVec(pB, pA);
    var segLen = lengthVec(dir);
    if (segLen < 0.005) continue;

    var segment = script.lineSegmentPrefab.instantiate(script.lineParent);

    // midpoint
    var mid = new vec3(
      (pA.x + pB.x) * 0.5,
      (pA.y + pB.y) * 0.5,
      (pA.z + pB.z) * 0.5,
    );
    segment.getTransform().setWorldPosition(mid);

    // compute normalized direction for rotation
    var dirNorm = normalizeSafe(dir);

    // rotate cylinder Y axis to align with direction
    var up = new vec3(0, 1, 0);
    var axis = up.cross(dirNorm);
    var axisLen = lengthVec(axis);

    if (axisLen > 0.000001) {
      axis = new vec3(axis.x / axisLen, axis.y / axisLen, axis.z / axisLen);
      var dot = up.dot(dirNorm);
      // clamp dot to avoid numeric issues
      if (dot > 1) dot = 1;
      if (dot < -1) dot = -1;
      var angle = Math.acos(dot);
      var rot = quat.angleAxis(angle, axis);
      segment.getTransform().setWorldRotation(rot);
    } else {
      // parallel or anti-parallel: if dot < 0, flip 180 around X
      var dot2 = up.dot(dirNorm);
      if (dot2 < 0) {
        var flip = quat.angleAxis(Math.PI, new vec3(1, 0, 0));
        segment.getTransform().setWorldRotation(flip);
      } else {
        // identity orientation
        segment
          .getTransform()
          .setWorldRotation(quat.angleAxis(0, new vec3(0, 1, 0)));
      }
    }

    // scale - assumes cylinder height axis is Y and original cylinder is unit height
    var thickness = 0.005; // tweak for visual
    segment
      .getTransform()
      .setLocalScale(new vec3(thickness, segLen * 0.005, thickness));
  }
}

// ------------ helpers (paste near top of script) -------------
function mulVec(v, s) {
  return new vec3(v.x * s, v.y * s, v.z * s);
}
function addVec(a, b) {
  return new vec3(a.x + b.x, a.y + b.y, a.z + b.z);
}
function subVec(a, b) {
  return new vec3(a.x - b.x, a.y - b.y, a.z - b.z);
}
function lengthVec(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}
function normalizeSafe(v) {
  var L = lengthVec(v);
  if (L <= 0.000001) return new vec3(0, 0, 0);
  return new vec3(v.x / L, v.y / L, v.z / L);
}

// Quadratic interpolation between a (t=0) and b (t=1) with control c
function quadInterp(a, b, c, t) {
  var omt = 1 - t;
  // result = a*(1-t)^2 + 2*(1-t)*t*c + b*(t^2)
  var partA = mulVec(a, omt * omt);
  var partC = mulVec(c, 2 * omt * t);
  var partB = mulVec(b, t * t);
  return addVec(addVec(partA, partC), partB);
}

// builds curved points for a list of world control points [P0, P1, P2, ...]
// returns a flat array of vec3 sampled along those curves
function buildCurvedPoints(
  worldPoints,
  subdivisionsPerSegment,
  curveHeightMultiplier,
  meanderFactor,
) {
  var result = [];
  if (!worldPoints || worldPoints.length < 2) return worldPoints.slice();

  // worldPoints: [waypoint, step1, step2, ...]
  for (var i = 0; i < worldPoints.length - 1; i++) {
    var a = worldPoints[i];
    var b = worldPoints[i + 1];

    // segment direction and length
    var direction = subVec(b, a);
    var segLen = lengthVec(direction);
    var dirNorm = normalizeSafe(direction);

    // midpoint
    var mid = mulVec(addVec(a, b), 0.5);

    // control point up-lift for curvature; proportional to segment length
    var up = new vec3(0, 1, 0);
    var curveHeight = segLen * curveHeightMultiplier;

    var control = addVec(mid, mulVec(up, curveHeight));

    // optional meander: perpendicular vector
    var perp = dirNorm.cross(up);
    var perpLen = lengthVec(perp);
    if (perpLen < 0.0001) {
      // if parallel, try different perp (X axis)
      perp = new vec3(1, 0, 0);
    } else {
      perp = mulVec(perp, 1.0 / perpLen);
    }

    // alternate sign to make the curve meander (left-right-left...)
    var sign = i % 2 === 0 ? 1 : -1;
    var meander = segLen * meanderFactor * sign;
    control = addVec(control, mulVec(perp, meander));

    // sample the quadratic from t=0..1 with subdivisions
    for (var s = 0; s <= subdivisionsPerSegment; s++) {
      var t = s / subdivisionsPerSegment;
      var p = quadInterp(a, b, control, t);
      result.push(p);
    }
    // Note: last point of segment equals first of next segment; duplicates are OK for this approach
  }
  return result;
}
