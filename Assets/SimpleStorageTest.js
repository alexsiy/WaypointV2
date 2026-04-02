// DemoProcessInitializer.js

var store = global.persistentStorageSystem.store;
var key = "demoProcess";

script.createEvent("OnStartEvent").bind(function () {

    store.clear();

    var existing = store.getString(key);

    if (!existing || existing.length === 0) {

        var demoProcess = {
            processName: "Demo Process",

            //POSITIVE Z: IN THE DIRECTION OF THE ARROW
            //Y: UP AND DOWN
            //POSITIVE X: LEFT RELATIVE TO THE ARROW
            //NEGATIVE X: RIGHT RELATIVE TO THE ARROW

            //SCALE
            //1 METER ~ 50 UNITS

            //NOTES FOR DEMO
            //WAYPOINT PLACEMENT: PLACE ON INNERMOST PANEL OF PODIUM
            //WAYPOINT ORIENTATION: TOWARDS YOU< ALONG THE PANEL

            steps: [
                { name: "WHITEBOARD \n Erase Whiteboard", x: -107.39, y: 4, z: -60.12 },
                { name: "TABLES \n Push Chairs In", x: -126, y: -8.2, z: 184.5 },
                { name: "PODIUM \n Turn off Electronics", x: 201.5, y: 26.25, z: -6 },
                { name: "WORKSTATIONS \n Clear Workstations", x: 190, y: -1.8, z: 355.5 },
                { name: "LIGHTS \n Turn off Lights", x: 98 , y: -8.5, z: 490.15 },
                { name: "DOORS \n Lock Doors", x: 75.5, y: -1.5, z: 525.3 }
            ]
        };

        store.putString(key, JSON.stringify(demoProcess));
        print("Demo process saved to storage.");
    }
});