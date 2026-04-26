var store = global.persistentStorageSystem.store;
var key = "demoProcess";

script.createEvent("OnStartEvent").bind(function () {
  var existing = store.getString(key);

  if (!existing || existing.length === 0) {
    store.putString(key, JSON.stringify(buildIndoorRouteCatalog()));
    print("Seeded indoor route catalog.");
    return;
  }

  try {
    var parsed = JSON.parse(existing);
    if (parsed.schemaVersion === 2) {
      return;
    }

    store.putString(key, JSON.stringify(migrateLegacyProcess(parsed)));
    print("Migrated legacy process into indoor route catalog.");
  } catch (error) {
    store.putString(key, JSON.stringify(buildIndoorRouteCatalog()));
    print("Rebuilt indoor route catalog after invalid storage data.");
  }
});

function buildIndoorRouteCatalog() {
  var geometry = [
    { id: "whiteboard", label: "WHITEBOARD", x: -107.39, y: 4, z: -60.12 },
    { id: "tables", label: "TABLES", x: -126, y: -8.2, z: 184.5 },
    { id: "podium", label: "PODIUM", x: 201.5, y: 26.25, z: -6 },
    {
      id: "workstations",
      label: "WORKSTATIONS",
      x: 190,
      y: -1.8,
      z: 355.5,
    },
    { id: "lights", label: "LIGHTS", x: 98, y: -8.5, z: 490.15 },
    { id: "doors", label: "DOORS", x: 75.5, y: -1.5, z: 525.3 },
  ];

  return {
    schemaVersion: 2,
    site: {
      id: "iyh-110",
      name: "IYH 110",
      mode: "indoor_fixed_site",
      originLabel: "Podium",
      alignmentHint:
        "Align the waypoint with the podium so the route matches the room.",
      circuits: [
        buildCircuit(
          geometry,
          "closing",
          "Closing Circuit",
          "Shut down and reset the room before leaving.",
          [
            "Erase Whiteboard",
            "Push Chairs In",
            "Turn Off Electronics",
            "Clear Workstations",
            "Turn Off Lights",
            "Lock Doors",
          ],
          [
            "Clear any remaining notes from the board.",
            "Reset the tables so the room is ready for the next group.",
            "Shut down the podium station and shared displays.",
            "Check that workstations are cleared for the next session.",
            "Confirm the room lights are off.",
            "Secure the room before leaving.",
          ],
        ),
        buildCircuit(
          geometry,
          "opening",
          "Opening Circuit",
          "Prepare the room before the next session begins.",
          [
            "Prep Whiteboard",
            "Stage Seating",
            "Power Up Electronics",
            "Wake Workstations",
            "Turn On Lights",
            "Unlock Entry",
          ],
          [
            "Make sure the board is clear and ready.",
            "Arrange chairs and tables for the incoming group.",
            "Wake the podium station and displays.",
            "Verify the workstations are ready to use.",
            "Bring the room lights to working level.",
            "Open the room for the next session.",
          ],
        ),
      ],
    },
    defaultCircuitId: "closing",
  };
}

function buildCircuit(geometry, id, name, description, actions, prompts) {
  var steps = [];

  for (var i = 0; i < geometry.length; i++) {
    steps.push({
      id: geometry[i].id,
      label: geometry[i].label,
      action: actions[i],
      prompt: prompts[i],
      name: geometry[i].label + "\n" + actions[i],
      x: geometry[i].x,
      y: geometry[i].y,
      z: geometry[i].z,
      triggerRadius: 55,
    });
  }

  return {
    id: id,
    name: name,
    description: description,
    entryHoldSeconds: 1.0,
    defaultTriggerRadius: 55,
    steps: steps,
  };
}

function migrateLegacyProcess(legacyData) {
  var catalog = buildIndoorRouteCatalog();

  if (!legacyData || !legacyData.steps || !legacyData.steps.length) {
    return catalog;
  }

  var migratedSteps = [];
  for (var i = 0; i < legacyData.steps.length; i++) {
    var legacyStep = legacyData.steps[i];
    migratedSteps.push({
      id: "legacy-step-" + i,
      label: legacyStep.name || "STEP " + (i + 1),
      action: legacyStep.name || "Step " + (i + 1),
      prompt: "Move to this room feature to continue the route.",
      name: legacyStep.name || "STEP " + (i + 1),
      x: legacyStep.x || 0,
      y: legacyStep.y || 0,
      z: legacyStep.z || 0,
      triggerRadius: 55,
    });
  }

  catalog.site.circuits = [
    {
      id: "closing",
      name: legacyData.processName || "Closing Circuit",
      description: "Recovered from the legacy fixed-site process.",
      entryHoldSeconds: 1.0,
      defaultTriggerRadius: 55,
      steps: migratedSteps,
    },
  ];
  catalog.defaultCircuitId = "closing";

  return catalog;
}
