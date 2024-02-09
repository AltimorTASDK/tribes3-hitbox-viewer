'use strict';

let renderer = null;
let camera = null;
let camera2d = null;
let heroModel = null;
let bones = {};
let hitboxes = [];

let heroScene = null;
let hitboxScene = null;
let headHitboxScene = null;
let screenScene = null;

let heroRt = null;
let hitboxRt = null;
let headHitboxRt = null;

let hitboxMaterial = null;
let headHitboxMaterial = null;

let cylinderGeom = null;
let halfSphereGeom = null;
let sphereGeom = null;
let boxGeom = null;

let cameraRotation = { Pitch: 0, Yaw: 0, Roll: 0 };
let dragging = false;

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
    return { X: rotated.X, Y: rotated.Y, Z: rotated.Z };
}

function vectorAdd(a, b)
{
    return { X: a.X + b.X, Y: a.Y + b.Y, Z: a.Z + b.Z };
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

function createHitbox(scene, material, hitbox, bone)
{
    for (const elem of hitbox.AggGeom.SphylElems ?? []) {
        const rotation = rotatorToQuat(elem.Rotation);
        const offset1 = vectorAdd(rotateVectorByQuaternion(
            {X: 0, Y: 0, Z:  elem.Length / 2}, rotation), elem.Center);
        const offset2 = vectorAdd(rotateVectorByQuaternion(
            {X: 0, Y: 0, Z: -elem.Length / 2}, rotation), elem.Center);
        const position1 = boneTransform(bone, offset1);
        const position2 = boneTransform(bone, offset2);
        createSphyl(scene, material, position1, position2, elem.Radius);
    }

    for (const elem of hitbox.AggGeom.SphereElems ?? []) {
        const center = boneTransform(bone, elem.Center);
        const sphere = new THREE.Mesh(sphereGeom, material);
        sphere.scale.set(elem.Radius, elem.Radius, elem.Radius);
        sphere.position.set(center.X, center.Y, center.Z);
        scene.add(sphere);
    }

    for (const elem of hitbox.AggGeom.BoxElems ?? []) {
        const center = boneTransform(bone, elem.Center);
        const box = new THREE.Mesh(boxGeom, material);
        box.scale.set(elem.X, elem.Y, elem.Z);
        bone.getWorldQuaternion(box.quaternion);
        box.rotateX(elem.Rotation.Pitch * Math.PI / 180 + Math.PI / 2);
        box.rotateY(elem.Rotation.Yaw * Math.PI / 180);
        box.rotateZ(elem.Rotation.Roll * Math.PI / -180);
        box.position.set(center.X, center.Y, center.Z);
        scene.add(box);
    }
}

function drawHitboxes(rt, drawHead)
{
    renderer.setRenderTarget(rt);
    renderer.render(hitboxScene, camera);
    renderer.setRenderTarget(null);
    return rt;
}

function updateBones(object)
{
    object.children.forEach(updateBones);

    if (object.type != "Bone")
        return;

    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    object.getWorldPosition(position);
    object.getWorldQuaternion(quaternion);
    quaternion.multiply(new THREE.Quaternion(Math.SQRT1_2, 0, 0, Math.SQRT1_2));
    bones[object.name] = object;
}

function drawHero(rt)
{
    renderer.setRenderTarget(rt);
    renderer.render(heroScene, camera);
    renderer.setRenderTarget(null);

    return rt;
}

function renderLoop()
{
    renderer.setRenderTarget(heroRt);
    renderer.render(heroScene, camera);

    renderer.setRenderTarget(hitboxRt);
    renderer.render(hitboxScene, camera);

    renderer.setRenderTarget(headHitboxRt);
    renderer.render(headHitboxScene, camera);

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

function createHitboxScene(drawHead)
{
    const scene = new THREE.Scene();
    addLights(scene);

    for (const hitbox of hitboxes.filter(h => ["Head", "Neck"].includes(h.BoneName) == drawHead)) {
        const material = drawHead ? headHitboxMaterial : hitboxMaterial;
        createHitbox(scene, material, hitbox, bones[hitbox.BoneName]);
    }

    return scene;
}

function createScreenScene()
{
    const scene = new THREE.Scene();
    const geometry = new THREE.PlaneGeometry(100, 100);

    const characterMat = new THREE.MeshBasicMaterial({map: heroRt.texture});
    const characterQuad = new THREE.Mesh(geometry, characterMat);

    const hitboxMat = new THREE.MeshBasicMaterial({
        map: hitboxRt.texture,
        opacity: 0.5,
        transparent: true
    });
    const hitboxQuad = new THREE.Mesh(geometry, hitboxMat);

    const headMat = new THREE.MeshBasicMaterial({
        map: headHitboxRt.texture,
        opacity: 0.5,
        transparent: true
    });
    const headQuad = new THREE.Mesh(geometry, headMat);

    scene.add(characterQuad);
    scene.add(hitboxQuad);
    scene.add(headQuad);

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
    renderer.outputEncoding = THREE.sRGBEncoding;
    document.body.appendChild(renderer.domElement);

    hitboxMaterial = new THREE.MeshStandardMaterial({color: 0x007FFF});
    headHitboxMaterial = new THREE.MeshStandardMaterial({color: 0xFF00FF});

    cylinderGeom = new THREE.CylinderGeometry(1, 1, 1, 32, 1);
    halfSphereGeom = new THREE.SphereGeometry(1, 16, 16, Math.PI, Math.PI);
    sphereGeom = new THREE.SphereGeometry(1, 16, 16);
    boxGeom = new THREE.BoxGeometry(1, 1, 1);

    heroRt = new THREE.WebGLRenderTarget(width, height);
    hitboxRt = new THREE.WebGLRenderTarget(width, height);
    headHitboxRt = new THREE.WebGLRenderTarget(width, height);

    heroScene = createHeroScene();
    hitboxScene = createHitboxScene(false);
    headHitboxScene = createHitboxScene(true);
    screenScene = createScreenScene();
}

function startRendering()
{
    const loader = new THREE.GLTFLoader();
    loader.load("models/MESH_PC_BloodEagleLight_A.glb",
        gltf => {
            gltf.scene.scale.set(100, 100, 100);
            gltf.scene.rotation.x = Math.PI / 2;
            gltf.scene.updateWorldMatrix(true, true);
            updateBones(gltf.scene);
            heroModel = gltf.scene;

            $.getJSON("/json/Core_HitboxPhysicsAsset2.json", data => {
                //hitboxes = Object.values(data)[0].SkeletalBodySetups.map(k => data[k]);
                hitboxes = {};
                renderInit();
                renderLoop();
            });
        },
        undefined,
        error => console.error(error));
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

    cameraRotation.Yaw -= event.movementX * 0.3;
    cameraRotation.Pitch += event.movementY * 0.3;
    updateCamera();
};

$(function()
{
    startRendering();
});