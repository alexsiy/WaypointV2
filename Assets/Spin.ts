
@component
export class NewScript extends BaseScriptComponent {

    @input
    speed: number = 1.0;

    @input
    axis: vec3 = new vec3(0, 1, 0);

    @input
    bobHeight: number = 2.0;   // How high it floats

    @input
    bobSpeed: number = 1.5;    // How fast it bobs

    private transform!: Transform;
    private startPosition: vec3 = new vec3(0, 0, 0);
    private time: number = 0;

    onAwake(): void {
        this.transform = this.sceneObject.getTransform();
        this.startPosition = this.transform.getLocalPosition();

        this.createEvent("UpdateEvent").bind(() => {
            const deltaTime = getDeltaTime();
            this.time += deltaTime;

            // ---- Rotation ----
            const rotation = quat.angleAxis(
                this.speed * deltaTime,
                this.axis
            );

            const currentRotation = this.transform.getLocalRotation();
            this.transform.setLocalRotation(
                rotation.multiply(currentRotation)
            );

            // ---- Floating Bob ----
            const offsetY = Math.sin(this.time * this.bobSpeed) * this.bobHeight;

            this.transform.setLocalPosition(new vec3(
                this.startPosition.x,
                this.startPosition.y + offsetY,
                this.startPosition.z
            ));
        });
    }

    // Set the base position the bob effect orbits around
    setBasePosition(pos: vec3): void {
        this.startPosition = new vec3(pos.x, pos.y, pos.z);
    }

    // Smoothly lift the base position from fromY to toY over duration seconds
    liftTo(fromY: number, toY: number, duration: number): void {
        this.startPosition = new vec3(this.startPosition.x, fromY, this.startPosition.z);
        if (duration <= 0) {
            this.startPosition = new vec3(this.startPosition.x, toY, this.startPosition.z);
            return;
        }
        let elapsed = 0;
        const evt = this.createEvent('UpdateEvent');
        evt.bind(() => {
            elapsed += getDeltaTime();
            const t = Math.min(1, elapsed / duration);
            const e = 1 - Math.pow(1 - t, 3); // ease-out cubic
            this.startPosition = new vec3(
                this.startPosition.x,
                fromY + (toY - fromY) * e,
                this.startPosition.z
            );
            if (t >= 1) (evt as any).enabled = false;
        });
    }
}
