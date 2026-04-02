@component
export class NewScript extends BaseScriptComponent {

    @input
    delaySeconds: number = 3.0;

    onAwake(): void {

        const delayedEvent = this.createEvent("DelayedCallbackEvent");

        delayedEvent.bind(() => {
            // Disable the scene object (makes it disappear)
            this.sceneObject.enabled = false;

            print("Object hidden after delay");
        });

        // Start delay timer
        delayedEvent.reset(this.delaySeconds);

        print("Delay started");
    }
}
