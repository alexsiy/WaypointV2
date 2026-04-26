// @input SceneObject waypointObject
// @input Component.Camera camera
// @input Component.ScriptComponent rotationSlider
// @input Component.ScriptComponent selectRotationSlider
// @input float spawnDistance = 50
// @input float defaultTriggerRadius = 55
// @input float defaultEntryHoldSeconds = 1
// @input float activeScaleMultiplier = 1.15
// @input float completedScaleMultiplier = 0.92
// @input float panelRevealRadius = 90
// @input float panelRevealSpeed = 6
// @input SceneObject rotationPivot
// @input Asset.ObjectPrefab lineSegmentPrefab
// @input SceneObject lineParent
// @input SceneObject[] stepObjects

var STORAGE_KEY = "demoProcess";

var currentMode = "none";
var slidersConnected = false;
var routeRunning = false;
var routeCompleted = false;
var activeStepIndex = -1;
var enteredStepAt = -1;
var activeSite = null;
var activeCircuit = null;
var routeSteps = [];

var stepTextComponents = [];
var stepBaseScales = [];
var stepPanelObjects = [];
var stepPanelBaseScales = [];
var stepPanelRevealProgress = [];

script.createEvent("OnStartEvent").bind(onStart);
script.createEvent("OnDisableEvent").bind(function () {
  routeRunning = false;
  currentMode = "none";
  enteredStepAt = -1;
  if (script.waypointObject) {
    script.waypointObject.enabled = false;
  }
});
script.createEvent("UpdateEvent").bind(updateRouteRuntime);

script.api.startNewLocationPlacement = function () {
  currentMode = "new";
  resetRouteRuntime(true);
  spawnInFrontOfCamera();
};

script.api.startSelectLocationPlacement = function () {
  currentMode = "select";

  if (!script.waypointObject.enabled) {
    spawnInFrontOfCamera();
  } else {
    script.waypointObject.enabled = true;
  }
};

script.api.startRunMode = function () {
  currentMode = "run";
};

script.api.resetIndoorRoute = function () {
  resetRouteRuntime(true);
};

script.api.loadDemoProcess = function (circuitId) {
  loadCircuitById(circuitId || "closing");
};

script.api.loadCircuitById = loadCircuitById;

script.api.getRouteProgress = function () {
  return {
    running: routeRunning,
    completed: routeCompleted,
    activeStepIndex: activeStepIndex,
    totalSteps: routeSteps.length,
    siteId: activeSite ? activeSite.id : "",
    circuitId: activeCircuit ? activeCircuit.id : "",
  };
};

function onStart() {
  cacheStepMetadata();
  hideRouteObjects();
  connectSliders();
}

function loadCircuitById(circuitId) {
  var catalog = loadStoredCatalog();
  if (!catalog || !catalog.site || !catalog.site.circuits) {
    print("No indoor route catalog available.");
    return;
  }

  activeSite = catalog.site;
  activeCircuit = findCircuit(
    activeSite.circuits,
    circuitId || catalog.defaultCircuitId,
  );

  if (!activeCircuit) {
    print("Unable to find requested circuit.");
    return;
  }

  routeSteps = clampStepsToScene(activeCircuit.steps || []);
  if (routeSteps.length === 0) {
    print("No usable route steps found.");
    return;
  }

  currentMode = "run";
  routeRunning = false;
  routeCompleted = false;
  activeStepIndex = 0;
  enteredStepAt = -1;

  if (!script.waypointObject.enabled) {
    spawnInFrontOfCamera();
  } else {
    script.waypointObject.enabled = true;
  }

  applyRouteLayout();
  routeRunning = true;
  refreshStepVisuals();
  logActiveStep();
  print("Loaded indoor circuit: " + activeCircuit.name);
}

function loadStoredCatalog() {
  var store = global.persistentStorageSystem.store;
  var jsonString = store.getString(STORAGE_KEY);

  if (!jsonString) {
    return null;
  }

  try {
    return normalizeCatalog(JSON.parse(jsonString));
  } catch (error) {
    print("Failed to parse indoor route catalog.");
    return null;
  }
}

function normalizeCatalog(data) {
  if (data && data.schemaVersion === 2 && data.site && data.site.circuits) {
    return data;
  }

  if (!data || !data.steps) {
    return null;
  }

  var legacySteps = [];
  for (var i = 0; i < data.steps.length; i++) {
    var legacyStep = data.steps[i];
    legacySteps.push({
      id: "legacy-step-" + i,
      label: legacyStep.name || "STEP " + (i + 1),
      action: legacyStep.name || "Step " + (i + 1),
      prompt: "Move to this room feature to continue the route.",
      name: legacyStep.name || "STEP " + (i + 1),
      x: legacyStep.x || 0,
      y: legacyStep.y || 0,
      z: legacyStep.z || 0,
      triggerRadius: script.defaultTriggerRadius,
    });
  }

  return {
    schemaVersion: 2,
    site: {
      id: "iyh-110",
      name: "IYH 110",
      mode: "indoor_fixed_site",
      originLabel: "Podium",
      circuits: [
        {
          id: "closing",
          name: data.processName || "Closing Circuit",
          description: "Recovered from legacy route data.",
          entryHoldSeconds: script.defaultEntryHoldSeconds,
          defaultTriggerRadius: script.defaultTriggerRadius,
          steps: legacySteps,
        },
      ],
    },
    defaultCircuitId: "closing",
  };
}

function findCircuit(circuits, circuitId) {
  if (!circuits || circuits.length === 0) {
    return null;
  }

  for (var i = 0; i < circuits.length; i++) {
    if (circuits[i] && circuits[i].id === circuitId) {
      return circuits[i];
    }
  }

  return circuits[0];
}

function clampStepsToScene(steps) {
  var usableSteps = [];
  var limit = Math.min(steps.length, script.stepObjects.length);

  for (var i = 0; i < limit; i++) {
    if (steps[i] && script.stepObjects[i]) {
      usableSteps.push(steps[i]);
    }
  }

  return usableSteps;
}

function applyRouteLayout() {
  for (var i = 0; i < script.stepObjects.length; i++) {
    var stepObject = script.stepObjects[i];
    if (!stepObject) {
      continue;
    }

    if (i >= routeSteps.length) {
      stepObject.enabled = false;
      continue;
    }

    var stepData = routeSteps[i];
    stepObject.enabled = true;
    stepObject
      .getTransform()
      .setLocalPosition(new vec3(stepData.x, stepData.y, stepData.z));
    setPanelRevealProgress(i, 0);
  }

  updateStepLine(routeSteps.length);
}

function updateRouteRuntime() {
  updateStepPanelReveal();

  if (!routeRunning || routeCompleted || activeStepIndex < 0) {
    return;
  }

  var stepObject = script.stepObjects[activeStepIndex];
  var stepData = routeSteps[activeStepIndex];
  if (!stepObject || !stepData) {
    return;
  }

  var triggerRadius =
    stepData.triggerRadius ||
    activeCircuit.defaultTriggerRadius ||
    script.defaultTriggerRadius;
  var holdSeconds =
    activeCircuit.entryHoldSeconds || script.defaultEntryHoldSeconds;
  var distance = getDistanceToStep(stepObject);

  if (distance > triggerRadius) {
    enteredStepAt = -1;
    return;
  }

  if (enteredStepAt < 0) {
    enteredStepAt = getTime();
    print(
      "Entered step zone: " +
        stepData.label +
        " (" +
        Math.round(distance) +
        " units)",
    );
    return;
  }

  if (getTime() - enteredStepAt >= holdSeconds) {
    completeCurrentStep();
  }
}

function completeCurrentStep() {
  if (activeStepIndex < 0 || activeStepIndex >= routeSteps.length) {
    return;
  }

  var completedStep = routeSteps[activeStepIndex];
  print(
    "Completed step " +
      (activeStepIndex + 1) +
      "/" +
      routeSteps.length +
      ": " +
      completedStep.action,
  );

  activeStepIndex += 1;
  enteredStepAt = -1;

  if (activeStepIndex >= routeSteps.length) {
    routeRunning = false;
    routeCompleted = true;
    activeStepIndex = routeSteps.length - 1;
    refreshStepVisuals();
    print("Indoor route complete.");
    return;
  }

  refreshStepVisuals();
  logActiveStep();
}

function logActiveStep() {
  if (activeStepIndex < 0 || activeStepIndex >= routeSteps.length) {
    return;
  }

  var stepData = routeSteps[activeStepIndex];
  print(
    "Active step " +
      (activeStepIndex + 1) +
      "/" +
      routeSteps.length +
      ": " +
      stepData.label +
      " -> " +
      stepData.action,
  );
}

function refreshStepVisuals() {
  for (var i = 0; i < routeSteps.length; i++) {
    var stepObject = script.stepObjects[i];
    var stepData = routeSteps[i];
    if (!stepObject || !stepData) {
      continue;
    }

    var state = "pending";
    if (routeCompleted || i < activeStepIndex) {
      state = "completed";
    } else if (i === activeStepIndex) {
      state = "current";
    }

    updateStepScale(stepObject, state, i);
    updateStepText(i, stepData, state);
  }
}

function updateStepScale(stepObject, state, index) {
  var baseScale = stepBaseScales[index] || new vec3(1, 1, 1);
  var scaleMultiplier = 1;

  if (state === "current") {
    scaleMultiplier = script.activeScaleMultiplier;
  } else if (state === "completed") {
    scaleMultiplier = script.completedScaleMultiplier;
  }

  stepObject
    .getTransform()
    .setLocalScale(mulVec(baseScale, scaleMultiplier));
}

function updateStepText(index, stepData, state) {
  var textComponent = stepTextComponents[index];
  if (!textComponent) {
    return;
  }

  var prefix = "STEP " + (index + 1);
  if (state === "current") {
    prefix = "NOW";
  } else if (state === "completed") {
    prefix = "DONE";
  }

  textComponent.text = prefix + "\n" + stepData.label + "\n" + stepData.action;
}

function getDistanceToStep(stepObject) {
  var cameraPosition = script.camera.getTransform().getWorldPosition();
  var stepPosition = stepObject.getTransform().getWorldPosition();
  return lengthVec(subVec(stepPosition, cameraPosition));
}

function resetRouteRuntime(hideObjects) {
  routeRunning = false;
  routeCompleted = false;
  activeStepIndex = -1;
  enteredStepAt = -1;
  activeSite = null;
  activeCircuit = null;
  routeSteps = [];

  if (hideObjects) {
    hideRouteObjects();
  }
}

function hideRouteObjects() {
  clearRenderedLines();

  for (var i = 0; i < script.stepObjects.length; i++) {
    var stepObject = script.stepObjects[i];
    if (!stepObject) {
      continue;
    }

    stepObject.enabled = false;
    if (stepBaseScales[i]) {
      stepObject.getTransform().setLocalScale(stepBaseScales[i]);
    }

    setPanelRevealProgress(i, 0);
  }

  if (script.waypointObject) {
    script.waypointObject.enabled = false;
  }
}

function spawnInFrontOfCamera() {
  var camTransform = script.camera.getTransform();
  var camPos = camTransform.getWorldPosition();
  var forward = camTransform.forward;
  var spawnPos = camPos.add(forward.uniformScale(-script.spawnDistance));

  script.waypointObject.enabled = true;
  script.waypointObject.getTransform().setWorldPosition(spawnPos);
}

function connectSliders() {
  if (slidersConnected) {
    return;
  }

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

    slidersConnected = true;
    print("Sliders connected");
  });

  delayed.reset(0);
}

function applyRotation(value) {
  var angle = value * Math.PI * 2;
  var rotation = quat.angleAxis(angle, vec3.up());

  script.rotationPivot.getTransform().setLocalRotation(rotation);
}

function cacheStepMetadata() {
  stepTextComponents = [];
  stepBaseScales = [];
  stepPanelObjects = [];
  stepPanelBaseScales = [];
  stepPanelRevealProgress = [];

  for (var i = 0; i < script.stepObjects.length; i++) {
    var stepObject = script.stepObjects[i];
    if (!stepObject) {
      stepTextComponents.push(null);
      stepBaseScales.push(new vec3(1, 1, 1));
      stepPanelObjects.push(null);
      stepPanelBaseScales.push(new vec3(1, 1, 1));
      stepPanelRevealProgress.push(0);
      continue;
    }

    var scale = stepObject.getTransform().getLocalScale();
    var panelObject = findPanelObject(stepObject);
    stepBaseScales.push(new vec3(scale.x, scale.y, scale.z));
    stepTextComponents.push(findTextComponent(stepObject));
    stepPanelObjects.push(panelObject);
    stepPanelBaseScales.push(
      panelObject
        ? cloneVec3(panelObject.getTransform().getLocalScale())
        : new vec3(1, 1, 1),
    );
    stepPanelRevealProgress.push(0);

    if (panelObject) {
      panelObject.getTransform().setLocalScale(new vec3(0.001, 0.001, 0.001));
    }
  }
}

function findPanelObject(stepObject) {
  for (var i = 0; i < stepObject.getChildrenCount(); i++) {
    var child = stepObject.getChild(i);
    if (child.name === "TextPanel") {
      return child;
    }
  }

  return null;
}

function findTextComponent(stepObject) {
  for (var c = 0; c < stepObject.getChildrenCount(); c++) {
    var child = stepObject.getChild(c);
    if (child.name !== "TextPanel") {
      continue;
    }

    for (var j = 0; j < child.getChildrenCount(); j++) {
      var grandChild = child.getChild(j);
      if (grandChild.name === "Text") {
        return grandChild.getComponent("Component.Text");
      }
    }
  }

  return null;
}

function updateStepPanelReveal() {
  if (routeSteps.length === 0) {
    return;
  }

  for (var i = 0; i < routeSteps.length; i++) {
    var stepObject = script.stepObjects[i];
    var panelObject = stepPanelObjects[i];
    if (!stepObject || !panelObject || !stepObject.enabled) {
      continue;
    }

    var distance = getDistanceToStep(stepObject);
    var target = distance <= script.panelRevealRadius ? 1 : 0;
    var current = stepPanelRevealProgress[i] || 0;
    var next = approachValue(current, target, getDeltaTime() * script.panelRevealSpeed);
    setPanelRevealProgress(i, next);
  }
}

function setPanelRevealProgress(index, progress) {
  stepPanelRevealProgress[index] = progress;

  var panelObject = stepPanelObjects[index];
  if (!panelObject) {
    return;
  }

  var eased = easeOutCubic(progress);
  var baseScale = stepPanelBaseScales[index] || new vec3(1, 1, 1);
  var visibleScale = mulVec(baseScale, eased);
  if (eased < 0.001) {
    visibleScale = new vec3(0.001, 0.001, 0.001);
  }

  panelObject.getTransform().setLocalScale(visibleScale);
}

function approachValue(current, target, amount) {
  var delta = target - current;
  if (Math.abs(delta) <= amount) {
    return target;
  }

  return current + (delta > 0 ? amount : -amount);
}

function easeOutCubic(value) {
  var inverse = 1 - value;
  return 1 - inverse * inverse * inverse;
}

function cloneVec3(value) {
  return new vec3(value.x, value.y, value.z);
}

function updateStepLine(processStepsCount) {
  if (!script.lineParent || !script.lineSegmentPrefab) {
    print("No lineParent or prefab assigned.");
    return;
  }

  clearRenderedLines();

  var worldPoints = [];
  worldPoints.push(script.rotationPivot.getTransform().getWorldPosition());

  for (var i = 0; i < processStepsCount; i++) {
    var stepObject = script.stepObjects[i];
    if (!stepObject) {
      continue;
    }

    worldPoints.push(stepObject.getTransform().getWorldPosition());
  }

  if (worldPoints.length < 2) {
    return;
  }

  var sampled = buildCurvedPoints(worldPoints, 6, 0.12, 0.06);

  for (var j = 0; j < sampled.length - 1; j++) {
    var pA = sampled[j];
    var pB = sampled[j + 1];
    var dir = subVec(pB, pA);
    var segLen = lengthVec(dir);
    if (segLen < 0.005) {
      continue;
    }

    var segment = script.lineSegmentPrefab.instantiate(script.lineParent);
    var mid = new vec3(
      (pA.x + pB.x) * 0.5,
      (pA.y + pB.y) * 0.5,
      (pA.z + pB.z) * 0.5,
    );
    segment.getTransform().setWorldPosition(mid);

    var dirNorm = normalizeSafe(dir);
    var up = new vec3(0, 1, 0);
    var axis = up.cross(dirNorm);
    var axisLen = lengthVec(axis);

    if (axisLen > 0.000001) {
      axis = new vec3(axis.x / axisLen, axis.y / axisLen, axis.z / axisLen);
      var dot = up.dot(dirNorm);
      if (dot > 1) dot = 1;
      if (dot < -1) dot = -1;
      segment
        .getTransform()
        .setWorldRotation(quat.angleAxis(Math.acos(dot), axis));
    } else if (up.dot(dirNorm) < 0) {
      segment
        .getTransform()
        .setWorldRotation(quat.angleAxis(Math.PI, new vec3(1, 0, 0)));
    } else {
      segment
        .getTransform()
        .setWorldRotation(quat.angleAxis(0, new vec3(0, 1, 0)));
    }

    segment
      .getTransform()
      .setLocalScale(new vec3(0.005, segLen * 0.005, 0.005));
  }
}

function clearRenderedLines() {
  if (!script.lineParent) {
    return;
  }

  for (var k = script.lineParent.getChildrenCount() - 1; k >= 0; k--) {
    script.lineParent.getChild(k).destroy();
  }
}

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
  var length = lengthVec(v);
  if (length <= 0.000001) return new vec3(0, 0, 0);
  return new vec3(v.x / length, v.y / length, v.z / length);
}

function quadInterp(a, b, c, t) {
  var omt = 1 - t;
  var partA = mulVec(a, omt * omt);
  var partC = mulVec(c, 2 * omt * t);
  var partB = mulVec(b, t * t);
  return addVec(addVec(partA, partC), partB);
}

function buildCurvedPoints(
  worldPoints,
  subdivisionsPerSegment,
  curveHeightMultiplier,
  meanderFactor,
) {
  var result = [];
  if (!worldPoints || worldPoints.length < 2) return worldPoints.slice();

  for (var i = 0; i < worldPoints.length - 1; i++) {
    var a = worldPoints[i];
    var b = worldPoints[i + 1];

    var direction = subVec(b, a);
    var segLen = lengthVec(direction);
    var dirNorm = normalizeSafe(direction);

    var mid = mulVec(addVec(a, b), 0.5);

    var up = new vec3(0, 1, 0);
    var curveHeight = segLen * curveHeightMultiplier;

    var control = addVec(mid, mulVec(up, curveHeight));

    var perp = dirNorm.cross(up);
    var perpLen = lengthVec(perp);
    if (perpLen < 0.0001) {
      perp = new vec3(1, 0, 0);
    } else {
      perp = mulVec(perp, 1.0 / perpLen);
    }

    var sign = i % 2 === 0 ? 1 : -1;
    var meander = segLen * meanderFactor * sign;
    control = addVec(control, mulVec(perp, meander));

    for (var s = 0; s <= subdivisionsPerSegment; s++) {
      var t = s / subdivisionsPerSegment;
      var p = quadInterp(a, b, control, t);
      result.push(p);
    }
  }
  return result;
}
