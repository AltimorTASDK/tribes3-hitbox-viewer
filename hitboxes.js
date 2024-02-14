import $ from 'jquery';
import 'jcanvas';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ARMOR_SCALE = 0.94;
const ARMOR_MESH = "/models/MESH_PC_BloodEagleLight_A.glb";
const ARMOR_JSON = "/json/SK_Mannequin_PhysicsAsset_Light.json";

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
    scene.add(new THREE.AmbientLight(0x404040));

    const light1 = new THREE.DirectionalLight(0xFFFFFF, 1.0);
    light1.position.set(200, 0, 100);
    scene.add(light1);

    const light2 = new THREE.DirectionalLight(0xFFFFFF, 0.5);
    light2.position.set(-200, 0, 100);
    scene.add(light2);
}

class Scene {
    #scene;

    constructor(camera)
    {
        this.camera = camera;
        this.#scene = undefined;
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

    #scenes;

    #updateBones(object, bones)
    {
        if (object.type === "Bone")
            bones[object.name] = object;

        object.children.forEach(child => this.#updateBones(child, bones));
    }

    #addScenes(camera3d, width, height, gltf, bones, hitboxes)
    {
        this.#scenes.push(
            new CharacterScene(camera3d, width, height, gltf),
            new HitboxScene(camera3d, width, height, hitboxes, bones,
                            0xFF7F00, e => e.Name === "hit_component"),
            new HitboxScene(camera3d, width, height, hitboxes, bones,
                            0x007FFF, e => e.Name !== "hit_component"));

        for (const {renderTargetMaterial} of this.#scenes)
            this.scene.add(new THREE.Mesh(CompositeScene.#fullscreenQuad, renderTargetMaterial));
    }

    constructor(camera2d, camera3d, width, height)
    {
        super(camera2d);

        this.#scenes = [];

        const gltfPromise = new Promise((resolve, reject) =>
            new GLTFLoader().load(ARMOR_MESH,
                gltf => resolve(gltf),
                undefined,
                error => console.error(error)));

        const jsonPromise = new Promise((resolve, reject) =>
            $.getJSON(ARMOR_JSON, json => resolve(json)));

        Promise.all([gltfPromise, jsonPromise]).then(([gltf, json]) => {
            const bones = [];
            this.#updateBones(gltf.scene, bones);

            const physicsAsset = json.find(object => object.Type === "PhysicsAsset");
            const hitboxes = physicsAsset.Properties.SkeletalBodySetups.map(object => {
                const index = object.ObjectPath.match(/\.(\d+)$/)[1];
                return json[index].Properties;
            });

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
    constructor(camera, width, height)
    {
        super(camera);
        this.renderTarget = this.createRenderTarget(width, height);
        this.renderTargetMaterial = this.createRenderTargetMaterial();
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
    #gltf;

    constructor(camera, width, height, gltf)
    {
        super(camera, width, height);
        this.#gltf = gltf;
    }

    createScene()
    {
        const scene = new THREE.Scene();
        addLights(scene);
        this.#gltf.scene.rotation.x = Math.PI / 2;
        this.#gltf.scene.rotation.y = Math.PI / 2;
        this.#gltf.scene.updateWorldMatrix(true, true);
        this.#gltf.scene.scale.setScalar(ARMOR_SCALE);
        scene.add(this.#gltf.scene);
        return scene;
    }
}

class HitboxScene extends RenderTargetScene {
    static #cylinderGeometry   = new THREE.CylinderGeometry(1, 1, 1, 32, 1);
    static #halfSphereGeometry = new THREE.SphereGeometry(1, 16, 16, Math.PI, Math.PI);
    static #sphereGeometry     = new THREE.SphereGeometry(1, 16, 16);
    static #boxGeometry        = new THREE.BoxGeometry(1, 1, 1);

    #hitboxes;
    #bones;
    #color;
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
        const bone = this.#bones[hitbox.BoneName];

        hitbox.AggGeom.SphylElems?.filter(this.#filter)?.forEach(elem => {
            const rotation = rotatorToQuaternion(elem.Rotation);
            const offset1 = rotateVectorByQuaternion({X: 0, Y: 0, Z:  elem.Length / 2}, rotation);
            const offset2 = rotateVectorByQuaternion({X: 0, Y: 0, Z: -elem.Length / 2}, rotation);
            const position1 = boneTransform(bone, vectorAdd(offset1, elem.Center));
            const position2 = boneTransform(bone, vectorAdd(offset2, elem.Center));
            const radius = elem.Radius * ARMOR_SCALE;
            this.#createSphyl(scene, material, position1, position2, radius);
        });

        hitbox.AggGeom.SphereElems?.filter(this.#filter)?.forEach(elem => {
            const center = boneTransform(bone, elem.Center);
            const sphere = new THREE.Mesh(HitboxScene.#sphereGeometry, material);
            sphere.scale.setScalar(elem.Radius * ARMOR_SCALE);
            sphere.position.set(center.X, center.Y, center.Z);
            scene.add(sphere);
        });

        hitbox.AggGeom.BoxElems?.filter(this.#filter)?.forEach(elem => {
            const center = boneTransform(bone, elem.Center);
            const box = new THREE.Mesh(HitboxScene.#boxGeometry, material);
            box.scale.set(elem.X, elem.Y, elem.Z);
            box.scale.multiplyScalar(ARMOR_SCALE);
            bone.getWorldQuaternion(box.quaternion);
            box.rotateX(elem.Rotation.Pitch *  Math.PI / 180 + Math.PI / 2);
            box.rotateY(elem.Rotation.Yaw   *  Math.PI / 180);
            box.rotateZ(elem.Rotation.Roll  * -Math.PI / 180);
            box.position.set(center.X, center.Y, center.Z);
            scene.add(box);
        });
    }

    constructor(camera, width, height, hitboxes, bones, color, filter)
    {
        super(camera, width, height);
        this.#hitboxes = hitboxes;
        this.#bones = bones;
        this.#color = color;
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
            opacity: 0.5,
            transparent: true,
        });
    }
}

function updateCamera(camera, cameraRotation)
{
    const quaternion = rotatorToQuaternion(cameraRotation);
    camera.quaternion.set(quaternion.X, quaternion.Y, quaternion.Z, quaternion.W);
    camera.quaternion.multiply(new THREE.Quaternion(0.5, 0.5, 0.5, 0.5));
    camera.position.set(0, 0, 700);
    camera.position.applyQuaternion(camera.quaternion);
    camera.position.z += 100;
    camera.fov = 5;
}

$(() => {
    THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

    const container = $("#renderer-container");
    const width = container.innerWidth();
    const height = container.innerHeight();

    const camera2d = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);
    const camera3d = new THREE.PerspectiveCamera(20, width / height, 0.1, 1000);

    const cameraRotation = {Pitch: 0, Yaw: 0, Roll: 0};
    updateCamera(camera3d, cameraRotation);

    $(document).on("mousemove", ({originalEvent: event}) => {
        if (!(event.buttons & 1))
            return;

        const ROTATION_SENSITIVITY = 0.3;

        cameraRotation.Yaw   -= event.movementX * ROTATION_SENSITIVITY;
        cameraRotation.Pitch += event.movementY * ROTATION_SENSITIVITY;
        updateCamera(camera3d, cameraRotation);
    });

    const scene = new CompositeScene(camera2d, camera3d, width, height);

    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    renderer.setClearAlpha(0.0);
    renderer.clear();
    renderer.setAnimationLoop(() => scene.draw(renderer));
    container.append(renderer.domElement);

});