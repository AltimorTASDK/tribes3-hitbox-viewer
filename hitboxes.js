import $ from 'jquery';
import 'jcanvas';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ROTATION_SENSITIVITY = 0.3;

let renderer = null;
let camera = null;
let camera2d = null;
let heroModel = null;
let bones = {};
let hitboxes = [];

let heroScene = null;
let hitboxScene = null;
let screenScene = null;

let heroRt = null;
let hitboxRt = null;

let cylinderGeom = null;
let halfSphereGeom = null;
let sphereGeom = null;
let boxGeom = null;

let cameraRotation = {Pitch: 0, Yaw: 0, Roll: 0};

function hamiltonProduct(a, b)
{
    return {
        X: a.W * b.X + a.X * b.W + a.Y * b.Z - a.Z * b.Y,
        Y: a.W * b.Y - a.X * b.Z + a.Y * b.W + a.Z * b.X,
        Z: a.W * b.Z + a.X * b.Y - a.Y * b.X + a.Z * b.W,
        W: a.W * b.W - a.X * b.X - a.Y * b.Y - a.Z * b.Z
    };
}

function quaternionInverse(quat)
{
    return {X: -quat.X, Y: -quat.Y, Z: -quat.Z, W: quat.W};
}

function rotateVectorByQuaternion(vector, rotation)
{
    let point = {X: vector.X, Y: vector.Y, Z: vector.Z, W: 0};
    let inverse = quaternionInverse(rotation);
    let rotated = hamiltonProduct(hamiltonProduct(rotation, point), inverse);
    return {X: rotated.X, Y: rotated.Y, Z: rotated.Z};
}

function vectorAdd(a, b)
{
    return {X: a.X + b.X, Y: a.Y + b.Y, Z: a.Z + b.Z};
}

function rotatorToQuat(rotator)
{
    const sp = Math.sin(rotator.Pitch * Math.PI / 360);
    const cp = Math.cos(rotator.Pitch * Math.PI / 360);
    const sy = Math.sin(rotator.Yaw * Math.PI / 360);
    const cy = Math.cos(rotator.Yaw * Math.PI / 360);
    const sr = Math.sin(rotator.Roll * Math.PI / 360);
    const cr = Math.cos(rotator.Roll * Math.PI / 360);

    return {
        X:  cr * sp * sy - sr * cp * cy,
        Y: -cr * sp * cy - sr * cp * sy,
        Z:  cr * cp * sy - sr * sp * cy,
        W:  cr * cp * cy + sr * sp * sy
    };
}

function boneTransform(bone, point)
{
    const world = bone.localToWorld(new THREE.Vector3(point.X / 100, point.Z / 100, point.Y / 100));
    return {X: world.x, Y: world.y, Z: world.z};
}

function createSphyl(scene, material, start, end, radius)
{
    const direction = new THREE.Vector3(end.X - start.X, end.Y - start.Y, end.Z - start.Z);
    const length = direction.length();
    direction.normalize();

    const cylinder = new THREE.Mesh(cylinderGeom, material);
    cylinder.scale.set(radius, length, radius);
    cylinder.lookAt(direction);
    cylinder.rotateX(Math.PI / 2);
    cylinder.position.set(start.X, start.Y, start.Z);
    cylinder.position.lerp(new THREE.Vector3(end.X, end.Y, end.Z), 0.5);
    scene.add(cylinder);

    const startCap = new THREE.Mesh(halfSphereGeom, material);
    startCap.scale.set(radius, radius, radius);
    startCap.lookAt(direction);
    startCap.position.set(start.X, start.Y, start.Z);
    scene.add(startCap);

    const endCap = new THREE.Mesh(halfSphereGeom, material);
    endCap.scale.set(radius, radius, radius);
    endCap.lookAt(direction);
    endCap.rotateX(Math.PI);
    endCap.position.set(end.X, end.Y, end.Z);
    scene.add(endCap);
}

function createHitbox(scene, material, hitbox)
{
    if (hitbox.BoneName !== "upperarm_l" && hitbox.BoneName !== "upperarm_r")
        return;

    const bone = bones[hitbox.BoneName];

    hitbox.AggGeom.SphylElems?.forEach(elem => {
        const rotation = rotatorToQuat(elem.Rotation);
        const offset1 = rotateVectorByQuaternion({X: 0, Y: 0, Z:  elem.Length / 2}, rotation);
        const offset2 = rotateVectorByQuaternion({X: 0, Y: 0, Z: -elem.Length / 2}, rotation);
        const position1 = boneTransform(bone, vectorAdd(offset1, elem.Center));
        const position2 = boneTransform(bone, vectorAdd(offset2, elem.Center));
        createSphyl(scene, material, position1, position2, elem.Radius);
    });

    hitbox.AggGeom.SphereElems?.forEach(elem => {
        const center = boneTransform(bone, elem.Center);
        const sphere = new THREE.Mesh(sphereGeom, material);
        sphere.scale.set(elem.Radius, elem.Radius, elem.Radius);
        sphere.position.set(center.X, center.Y, center.Z);
        scene.add(sphere);
    });

    hitbox.AggGeom.BoxElems?.forEach(elem => {
        const center = boneTransform(bone, elem.Center);
        const box = new THREE.Mesh(boxGeom, material);
        box.scale.set(elem.X, elem.Y, elem.Z);
        bone.getWorldQuaternion(box.quaternion);
        box.rotateX(elem.Rotation.Pitch *  Math.PI / 180 + Math.PI / 2);
        box.rotateY(elem.Rotation.Yaw   *  Math.PI / 180);
        box.rotateZ(elem.Rotation.Roll  * -Math.PI / 180);
        box.position.set(center.X, center.Y, center.Z);
        scene.add(box);
    });
}

function updateBones(object)
{
    if (object.type == "Bone")
        bones[object.name] = object;

    object.children.forEach(updateBones);
}

function renderLoop()
{
    renderer.setRenderTarget(heroRt);
    renderer.render(heroScene, camera);

    renderer.setRenderTarget(hitboxRt);
    renderer.render(hitboxScene, camera);

    renderer.setRenderTarget(null);
    renderer.render(screenScene, camera2d);

    requestAnimationFrame(renderLoop);
}

function addLights(scene)
{
    scene.add(new THREE.AmbientLight(0x404040));
    const light = new THREE.DirectionalLight(0xFFFFFF, 1.0);
    light.position.set(200, 0, 200);
    scene.add(light);
}

function createHeroScene()
{
    const scene = new THREE.Scene();
    addLights(scene);
    scene.add(heroModel);
    return scene;
}

function createHitboxScene()
{
    const scene = new THREE.Scene();
    addLights(scene);
    const material = new THREE.MeshStandardMaterial({color: 0x007FFF});
    hitboxes.forEach(hitbox => createHitbox(scene, material, hitbox));
    return scene;
}

function createScreenScene()
{
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(100, 100);

    // character
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        map: heroRt.texture,
    })));

    // hitboxes
    scene.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
        map: hitboxRt.texture,
        opacity: 0.5,
        transparent: true,
    })));

    return scene;
}

function renderInit()
{
    const width = window.innerWidth;
    const height = window.innerHeight;
    camera = new THREE.PerspectiveCamera(74, width / height, 0.1, 1000);
    camera.position.x = 200;
    camera.position.z = 100;
    camera.rotation.y = Math.PI / 2;
    camera.rotation.z = Math.PI / 2;

    camera2d = new THREE.OrthographicCamera(-50, 50, 50, -50, 0, 1);

    renderer = new THREE.WebGLRenderer();
    renderer.setSize(width, height);
    document.body.appendChild(renderer.domElement);

    cylinderGeom = new THREE.CylinderGeometry(1, 1, 1, 32, 1);
    halfSphereGeom = new THREE.SphereGeometry(1, 16, 16, Math.PI, Math.PI);
    sphereGeom = new THREE.SphereGeometry(1, 16, 16);
    boxGeom = new THREE.BoxGeometry(1, 1, 1);

    heroRt = new THREE.WebGLRenderTarget(width, height);
    hitboxRt = new THREE.WebGLRenderTarget(width, height);

    heroScene = createHeroScene();
    hitboxScene = createHitboxScene();
    screenScene = createScreenScene();
}

function updateCamera()
{
    const quat = rotatorToQuat(cameraRotation);
    camera.quaternion.set(quat.X, quat.Y, quat.Z, quat.W);
    camera.quaternion.multiply(new THREE.Quaternion(0.5, 0.5, 0.5, 0.5));
    camera.position.set(0, 0, 200);
    camera.position.applyQuaternion(camera.quaternion);
    camera.position.z += 100;
}

document.onmousemove = function(event)
{
    if (camera == null || !(event.buttons & 1))
        return;

    cameraRotation.Yaw   -= event.movementX * ROTATION_SENSITIVITY;
    cameraRotation.Pitch += event.movementY * ROTATION_SENSITIVITY;
    updateCamera();
};

$(function()
{
    new GLTFLoader().load("/models/MESH_PC_BloodEagleLight_A.glb",
        gltf => {
            heroModel = gltf.scene;

            heroModel.scale.set(100, 100, 100);
            heroModel.rotation.x = Math.PI / 2;
            heroModel.updateWorldMatrix(true, true);
            updateBones(heroModel);

            $.getJSON("/json/SK_Mannequin_PhysicsAsset_Light.json", data => {
                hitboxes = data[0].Properties.SkeletalBodySetups.map(obj => {
                    const split = obj.ObjectPath.split('.');
                    const index = split[split.length - 1];
                    return data[index].Properties;
                });
                renderInit();
                renderLoop();
            });
        },
        undefined,
        error => console.error(error));
});