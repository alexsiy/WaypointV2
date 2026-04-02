// Billboard.js
// @input Component.Camera camera

script.createEvent("UpdateEvent").bind(function () {

    var camPos = script.camera.getTransform().getWorldPosition();
    var myPos = script.getSceneObject().getTransform().getWorldPosition();

    var direction = camPos.sub(myPos).normalize();

    var lookRot = quat.lookAt(direction, vec3.up());

    script.getSceneObject().getTransform().setWorldRotation(lookRot);
});