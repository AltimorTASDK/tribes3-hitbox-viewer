import $ from 'jquery';
import 'jcanvas';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE_HEIGHT = 200;

const ARMORS = [
    {
        name: "Light",
        offsetZ: -89.0,
        scale: 0.94,
        radius: 50,
        height: 176,
        mesh: "/models/MESH_PC_BloodEagleLight_A.glb",
        json: "/json/SK_Mannequin_PhysicsAsset_Light.json"
    },
    {
        name: "Medium",
        offsetZ: -90.0,
        scale: 1.015,
        radius: 50,
        height: 176,
        mesh: "/models/MESH_PC_BloodEagleMed.glb",
        json: "/json/SK_Mannequin_PhysicsAsset_Medium.json"
    },
    {
        name: "Heavy",
        offsetZ: -97.0,
        scale: 1.05,
        radius: 50,
        height: 196,
        mesh: "/models/MESH_PC_DSwordHeavy.glb",
        json: "/json/SK_Mannequin_PhysicsAsset_Heavy.json"
    }
];

function hamiltonProduct(a, b)
{
    return {
        X: a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
        Y: a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
        Z: a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
        W: a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z
    };
}

function quaternionInverse(quaternion)
{
    return {X: -quaternion.X, Y: -quaternion.Y, Z: -quaternion.Z, W: quaternion.W};
}

function rotateVectorByQuaternion(vector, rotation)
{
    const point = {X: vector.X, Y: vector.Y, Z: vector.Z, W: 0};
    const inverse = quaternionInverse(rotation);
    const rotated = hamiltonProduct(hamiltonProduct(rotation, point), inverse);
    return {X: rotated.X, Y: rotated.Y, Z: rotated.Z};
}

function vectorAdd(a, b)
{
    return {X: a.X + b.X, Y: a.Y + b.Y, Z: a.Z + b.Z};
}

function rotatorToQuaternion(rotator)
{
    const sp = Math.sin(rotator.Pitch * Math.PI / 360);
    const cp = Math.cos(rotator.Pitch * Math.PI / 360);
    const sy = Math.sin(rotator.Yaw   * Math.PI / 360);
    const cy = Math.cos(rotator.Yaw   * Math.PI / 360);
    const sr = Math.sin(rotator.Roll  * Math.PI / 360);
    const cr = Math.cos(rotator.Roll  * Math.PI / 360);

    return {
        X:  cr * sp * sy - sr * cp * cy,
        Y: -cr * sp * cy - sr * cp * sy,
        Z:  cr * cp * sy - sr * sp * cy,
        W:  cr * cp * cy + sr * sp * sy
    };
}

function boneTransform(bone, point)
{
    const world = bone.localToWorld(new THREE.Vector3(point.X, point.Y, point.Z));
    return {X: world.x, Y: world.y, Z: world.z};
}

function addLights(scene)
{
    scene.add(new THREE.AmbientLight(0xFFFFFF, 1.0));

    const light1 = new THREE.DirectionalLight(0xFFFFFF, 1.0);
    light1.position.set(0, -200, 100);
    scene.add(light1);

    const light2 = new THREE.DirectionalLight(0xFFFFFF, 0.5);
    light2.position.set(0, 200, 100);
    scene.add(light2);
}

class ArmorOption extends HTMLElement {
    static observedAttributes = ["index"];

    #index;
    #text = document.createElement("div");

    constructor()
    {
        super();

        this.appendChild(this.#text);

        this.addEventListener("click", event => {
            this.dispatchEvent(new CustomEvent("armor-selected", {
                bubbles: true,
                composed: true,
                detail: {index: this.#index}
            }));
        });
    }

    #setIndex(index)
    {
        this.#index = index;
        this.#text.textContent = ARMORS[index]?.name;
    }

    attributeChangedCallback(name, oldValue, newValue)
    {
        switch (name) {
            case "index":
                this.#setIndex(newValue);
                break;
        }
    }
}

customElements.define("armor-option", ArmorOption);

class ArmorSelector extends HTMLElement {
    constructor()
    {
        super();

        for (let i = 0; i < ARMORS.length; i++) {
            const option = new ArmorOption();
            option.setAttribute("index", i);
            this.appendChild(option);
        }
    }
}

customElements.define("armor-selector", ArmorSelector);

class Scene {
    #scene;

    constructor(camera)
    {
        this.camera = camera;
    }

    get scene()
    {
        // Lazy create after constructor runs
        if (this.#scene === undefined)
            this.#scene = this.createScene();

        return this.#scene;
    }

    draw(renderer)
    {
        renderer.setRenderTarget(null);
        renderer.render(this.scene, this.camera);
    }

    createScene()
    {
        return null;
    }
}

class CompositeScene extends Scene {
    static #fullscreenQuad = new THREE.PlaneGeometry(1, 1);

    #armor;
    #scenes;

    #updateBones(object, bones)
    {
        if (bones === undefined)
            bones = [];

        if (object.type === "Bone")
            bones[object.name.toLowerCase()] = object;

        object.children.forEach(child => this.#updateBones(child, bones));
        return bones;
    }

    #addScenes(camera3d, width, height, gltf, bones, hitboxes)
    {
        this.#scenes.push(
            new CharacterScene(camera3d, width, height, gltf),
            new HitboxScene(this.#armor, camera3d, width, height, hitboxes, bones,
                            0xFF0000, 0.5, e => e.Name === "hit_component"),
            new HitboxScene(this.#armor, camera3d, width, height, hitboxes, bones,
                            0xFF8000, 0.7, e => e.Name !== "hit_component"),
            new CollisionScene(this.#armor, camera3d, width, height,
                            0x0000FF, 0.3));

        for (const {renderTargetMaterial} of this.#scenes)
            this.scene.add(new THREE.Mesh(CompositeScene.#fullscreenQuad, renderTargetMaterial));
    }

    constructor(armor, camera2d, camera3d, width, height)
    {
        super(camera2d);

        this.#armor = armor;
        this.#scenes = [];

        const gltfPromise = new Promise((resolve, reject) =>
            new GLTFLoader().load(armor.mesh, resolve, undefined, console.error));

        const jsonPromise = new Promise((resolve, reject) =>
            $.getJSON(armor.json, json => resolve(json)));

        Promise.all([gltfPromise, jsonPromise]).then(([gltf, json]) => {
            const bones = this.#updateBones(gltf.scene);

            const physicsAsset = json.find(object => object.Type === "PhysicsAsset");
            const hitboxes = physicsAsset.Properties.SkeletalBodySetups.map(object => {
                const index = object.ObjectPath.match(/\.(\d+)$/)[1];
                return json[index].Properties;
            });

            gltf.scene.position.z = armor.offsetZ;
            gltf.scene.scale.setScalar(armor.scale);

            this.#addScenes(camera3d, width, height, gltf, bones, hitboxes);
        });
    }

    draw(renderer)
    {
        this.#scenes.forEach(scene => scene.draw(renderer));
        super.draw(renderer);
    }

    createScene()
    {
        return new THREE.Scene();
    }
}

class RenderTargetScene extends Scene {
    #width;
    #height;
    #renderTarget;
    #renderTargetMaterial;

    constructor(camera, width, height)
    {
        super(camera);
        this.#width = width;
        this.#height = height;
    }

    get renderTarget()
    {
        if (this.#renderTarget === undefined)
            this.#renderTarget = this.createRenderTarget(this.#width, this.#height);

        return this.#renderTarget;
    }

    get renderTargetMaterial()
    {
        if (this.#renderTargetMaterial === undefined)
            this.#renderTargetMaterial = this.createRenderTargetMaterial();

        return this.#renderTargetMaterial;
    }

    draw(renderer)
    {
        renderer.setRenderTarget(this.renderTarget);
        renderer.render(this.scene, this.camera);
    }

    createRenderTarget(width, height)
    {
        return new THREE.WebGLRenderTarget(width, height, {type: THREE.FloatType});
    }

    createRenderTargetMaterial()
    {
        return new THREE.MeshBasicMaterial({
            map: this.renderTarget.texture,
            transparent: true,
        });
    }
}

class CharacterScene extends RenderTargetScene {
    #clock;
    #gltf;
    #mixer;

    constructor(camera, width, height, gltf)
    {
        super(camera, width, height);
        this.#gltf = gltf;
        this.#clock = new THREE.Clock();
        this.#mixer = new THREE.AnimationMixer(this.#gltf.scene);
        this.#mixer.clipAction(this.#gltf.animations[0]).play();
    }

    draw(renderer)
    {
        this.#mixer.update(this.#clock.getDelta());
        super.draw(renderer);
    }

    createScene()
    {
        const scene = new THREE.Scene();
        addLights(scene);
        scene.add(this.#gltf.scene);
        return scene;
    }
}

class HitboxScene extends RenderTargetScene {
    static #cylinderGeometry   = new THREE.CylinderGeometry(1, 1, 1, 32, 1);
    static #halfSphereGeometry = new THREE.SphereGeometry(1, 16, 16, Math.PI, Math.PI);
    static #sphereGeometry     = new THREE.SphereGeometry(1, 16, 16);
    static #boxGeometry        = new THREE.BoxGeometry(1, 1, 1);

    #armor;
    #hitboxes;
    #bones;
    #color;
    opacity;
    #filter;

    #createSphyl(scene, material, start, end, radius)
    {
        const direction = new THREE.Vector3(end.X - start.X, end.Y - start.Y, end.Z - start.Z);
        const length = direction.length();
        direction.normalize();

        const cylinder = new THREE.Mesh(HitboxScene.#cylinderGeometry, material);
        cylinder.scale.set(radius, length, radius);
        cylinder.lookAt(direction);
        cylinder.rotateX(Math.PI / 2);
        cylinder.position.set(start.X, start.Y, start.Z);
        cylinder.position.lerp(new THREE.Vector3(end.X, end.Y, end.Z), 0.5);
        scene.add(cylinder);

        const startCap = new THREE.Mesh(HitboxScene.#halfSphereGeometry, material);
        startCap.scale.set(radius, radius, radius);
        startCap.lookAt(direction);
        startCap.position.set(start.X, start.Y, start.Z);
        scene.add(startCap);

        const endCap = new THREE.Mesh(HitboxScene.#halfSphereGeometry, material);
        endCap.scale.set(radius, radius, radius);
        endCap.lookAt(direction);
        endCap.rotateX(Math.PI);
        endCap.position.set(end.X, end.Y, end.Z);
        scene.add(endCap);
    }

    #createHitbox(scene, material, hitbox)
    {
        const bone = this.#bones[hitbox.BoneName.toLowerCase()];
        const scale = this.#armor.scale;

        hitbox.AggGeom.SphylElems?.filter(this.#filter)?.forEach(elem => {
            const rotation = rotatorToQuaternion(elem.Rotation);
            const offset1 = rotateVectorByQuaternion({X: 0, Y: 0, Z:  elem.Length / 2}, rotation);
            const offset2 = rotateVectorByQuaternion({X: 0, Y: 0, Z: -elem.Length / 2}, rotation);
            const position1 = boneTransform(bone, vectorAdd(offset1, elem.Center));
            const position2 = boneTransform(bone, vectorAdd(offset2, elem.Center));
            const radius = elem.Radius * scale;
            this.#createSphyl(scene, material, position1, position2, radius);
        });

        hitbox.AggGeom.SphereElems?.filter(this.#filter)?.forEach(elem => {
            const center = boneTransform(bone, elem.Center);
            const sphere = new THREE.Mesh(HitboxScene.#sphereGeometry, material);
            sphere.scale.setScalar(elem.Radius * scale);
            sphere.position.set(center.X, center.Y, center.Z);
            scene.add(sphere);
        });

        hitbox.AggGeom.BoxElems?.filter(this.#filter)?.forEach(elem => {
            const center = boneTransform(bone, elem.Center);
            const box = new THREE.Mesh(HitboxScene.#boxGeometry, material);
            box.scale.set(elem.X, elem.Y, elem.Z);
            box.scale.multiplyScalar(scale);
            bone.getWorldQuaternion(box.quaternion);
            box.rotateX(elem.Rotation.Pitch *  Math.PI / 180 + Math.PI / 2);
            box.rotateY(elem.Rotation.Yaw   *  Math.PI / 180);
            box.rotateZ(elem.Rotation.Roll  * -Math.PI / 180);
            box.position.set(center.X, center.Y, center.Z);
            scene.add(box);
        });
    }

    constructor(armor, camera, width, height, hitboxes, bones, color, opacity, filter)
    {
        super(camera, width, height);
        this.#armor = armor;
        this.#hitboxes = hitboxes;
        this.#bones = bones;
        this.#color = color;
        this.opacity = opacity;
        this.#filter = filter;
    }

    createScene()
    {
        const scene = new THREE.Scene();
        addLights(scene);
        const material = new THREE.MeshStandardMaterial({color: this.#color});
        this.#hitboxes.forEach(hitbox => this.#createHitbox(scene, material, hitbox));
        return scene;
    }

    createRenderTargetMaterial()
    {
        return new THREE.MeshBasicMaterial({
            map: this.renderTarget.texture,
            opacity: this.opacity,
            transparent: true
        });
    }
}

class CollisionScene extends RenderTargetScene {
    static #cylinderGeometry   = new THREE.CylinderGeometry(1, 1, 1, 32, 1);
    static #halfSphereGeometry = new THREE.SphereGeometry(1, 16, 16, Math.PI, Math.PI);

    #armor;
    #color;
    #opacity;

    #createSphyl(scene, material, start, end, radius)
    {
        const direction = new THREE.Vector3(end.X - start.X, end.Y - start.Y, end.Z - start.Z);
        const length = direction.length();
        direction.normalize();

        const cylinder = new THREE.Mesh(CollisionScene.#cylinderGeometry, material);
        cylinder.scale.set(radius, length, radius);
        cylinder.lookAt(direction);
        cylinder.rotateX(Math.PI / 2);
        cylinder.position.set(start.X, start.Y, start.Z);
        cylinder.position.lerp(new THREE.Vector3(end.X, end.Y, end.Z), 0.5);
        scene.add(cylinder);

        const startCap = new THREE.Mesh(CollisionScene.#halfSphereGeometry, material);
        startCap.scale.set(radius, radius, radius);
        startCap.lookAt(direction);
        startCap.position.set(start.X, start.Y, start.Z);
        scene.add(startCap);

        const endCap = new THREE.Mesh(CollisionScene.#halfSphereGeometry, material);
        endCap.scale.set(radius, radius, radius);
        endCap.lookAt(direction);
        endCap.rotateX(Math.PI);
        endCap.position.set(end.X, end.Y, end.Z);
        scene.add(endCap);
    }

    #createCollision(scene, material)
    {
        const radius = this.#armor.radius;
        const offset = this.#armor.height / 2 - radius;
        const position1 = {X: 0, Y: 0, Z:  offset};
        const position2 = {X: 0, Y: 0, Z: -offset};
        this.#createSphyl(scene, material, position1, position2, radius);
    }

    constructor(armor, camera, width, height, color, opacity)
    {
        super(camera, width, height);
        this.#armor = armor;
        this.#color = color;
        this.#opacity = opacity;
    }

    createScene()
    {
        const scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xFFFFFF, 3.15));
        const material = new THREE.MeshStandardMaterial({color: this.#color});
        this.#createCollision(scene, material);
        return scene;
    }

    createRenderTargetMaterial()
    {
        return new THREE.MeshBasicMaterial({
            map: this.renderTarget.texture,
            opacity: this.#opacity,
            transparent: true
        });
    }
}

function updateCamera(armor, camera, cameraRotation)
{
    const quat = rotatorToQuaternion(cameraRotation);
    camera.position.set(700, 0, 0);
    camera.position.applyQuaternion(new THREE.Quaternion(quat.X, quat.Y, quat.Z, quat.W));
    camera.position.applyEuler(new THREE.Euler(0, 0, -Math.PI / 2));
    // Make offset to bottom of capsule consistent
    const adjust = (BASE_HEIGHT - armor.height) / 2;
    camera.position.z += adjust;
    camera.lookAt(0, 0, adjust);
}

$(() => {
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

    const container = $("#renderer-container");
    const width = container.innerWidth();
    const height = container.innerHeight();

    const camera2d = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    const camera3d = new THREE.PerspectiveCamera(20, width / height, 0.1, 1000);

    const cameraRotation = {Pitch: 0, Yaw: 0, Roll: 0};

    let armor = ARMORS[0];
    let dragging = false;

    container.on("mousedown", ({originalEvent: event}) => {
        if (event.button === 0)
            dragging = true;
    });

    $(document).on("mouseup", ({originalEvent: event}) => {
        if (event.button === 0)
            dragging = false;
    });

    $(document).on("mousemove", ({originalEvent: event}) => {
        if (!dragging || !(event.buttons & 1))
            return;

        const ROTATION_SENSITIVITY = 0.3;

        cameraRotation.Yaw   -= event.movementX * ROTATION_SENSITIVITY;
        cameraRotation.Pitch += event.movementY * ROTATION_SENSITIVITY;
        cameraRotation.Pitch = Math.min(Math.max(cameraRotation.Pitch, -89), 89);
        updateCamera(armor, camera3d, cameraRotation);
    });

    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    renderer.setClearAlpha(0.0);
    renderer.clear();
    container.append(renderer.domElement);

    function loadScene(index)
    {
        armor = ARMORS[index];
        updateCamera(armor, camera3d, cameraRotation);
        const scene = new CompositeScene(armor, camera2d, camera3d, width, height);
        renderer.setAnimationLoop(() => scene.draw(renderer));
    }

    addEventListener("armor-selected", event => loadScene(event.detail.index));

    loadScene(0);
});