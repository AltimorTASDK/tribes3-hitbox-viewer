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

function toThreeVector(vector)
{
    return new THREE.Vector3(vector.X, vector.Y, vector.Z);
}

function rotatorToQuaternion(rotator)
{
    const sp = Math.sin(rotator.Pitch * Math.PI / 360);
    const cp = Math.cos(rotator.Pitch * Math.PI / 360);
    const sy = Math.sin(rotator.Yaw   * Math.PI / 360);
    const cy = Math.cos(rotator.Yaw   * Math.PI / 360);
    const sr = Math.sin(rotator.Roll  * Math.PI / 360);
    const cr = Math.cos(rotator.Roll  * Math.PI / 360);

    return new THREE.Quaternion(
         cr * sp * sy - sr * cp * cy,
        -cr * sp * cy - sr * cp * sy,
         cr * cp * sy - sr * sp * cy,
         cr * cp * cy + sr * sp * sy);
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
    static #orthoCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);

    #width;
    #height;
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

    #addScenes(camera, gltf, bones, hitboxes)
    {
        const width = this.#width;
        const height = this.#height;

        this.#scenes.push(
            new CharacterScene(camera, width, height, gltf),
            new HitboxScene(this.#armor, camera, width, height, hitboxes, bones,
                            0x2060FF, 0.6, e => e.Name === "hit_component"),
            new HitboxScene(this.#armor, camera, width, height, hitboxes, bones,
                            0x4080FF, 0.7, e => e.Name !== "hit_component"),
            new CollisionScene(this.#armor, camera, width, height,
                            0xFFFFFF, 0.7));

        for (const {renderTargetMaterial} of this.#scenes)
            this.scene.add(new THREE.Mesh(CompositeScene.#fullscreenQuad, renderTargetMaterial));
    }

    constructor(armor, camera, width, height)
    {
        super(CompositeScene.#orthoCamera);

        this.#width = width;
        this.#height = height;
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

            this.#addScenes(camera, gltf, bones, hitboxes);
        });
    }

    resize(width, height)
    {
        this.#width = width;
        this.#height = height;
        this.#scenes.forEach(scene => scene.resize(width, height));
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
            this.updateRenderTarget();

        return this.#renderTarget;
    }

    get renderTargetMaterial()
    {
        if (this.#renderTargetMaterial === undefined)
            this.updateRenderTargetMaterial();

        return this.#renderTargetMaterial;
    }

    updateRenderTarget()
    {
        this.#renderTarget = this.createRenderTarget(this.#width, this.#height);
    }

    updateRenderTargetMaterial()
    {
        this.#renderTargetMaterial = this.createRenderTargetMaterial();
    }

    resize(width, height)
    {
        this.#width = width;
        this.#height = height;
        this.#renderTarget = undefined;
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
    static #sphereGeometry = new THREE.SphereGeometry(1, 16, 16);
    static #boxGeometry    = new THREE.BoxGeometry(1, 1, 1);

    #armor;
    #hitboxes;
    #bones;
    #color;
    opacity;
    #filter;

    #createSphyl(scene, material, elem, bone)
    {
        if (elem.Length === 0.0) {
            this.#createSphere(scene, material, elem, bone);
            return;
        }

        const quaternion  = rotatorToQuaternion(elem.Rotation);
        const localOffset = new THREE.Vector3(0, 0, elem.Length / 2).applyQuaternion(quaternion);
        const localCenter = toThreeVector(elem.Center);

        const center = bone.localToWorld(localCenter.clone());
        const offset = bone.localToWorld(localCenter.clone().add(localOffset)).sub(center);
        const radius = elem.Radius * this.#armor.scale;

        const geometry = new THREE.CapsuleGeometry(radius, offset.length() * 2, 8, 32);
        const capsule = new THREE.Mesh(geometry, material);
        capsule.lookAt(offset);
        capsule.rotateX(Math.PI / 2);
        capsule.position.copy(center);
        scene.add(capsule);
    }

    #createSphere(scene, material, elem, bone)
    {
        const center = bone.localToWorld(toThreeVector(elem.Center));
        const sphere = new THREE.Mesh(HitboxScene.#sphereGeometry, material);
        sphere.scale.setScalar(elem.Radius * this.#armor.scale);
        sphere.position.copy(center);
        scene.add(sphere);
    }

    #createBox(scene, material, elem, bone)
    {
        const center = bone.localToWorld(toThreeVector(elem.Center));
        const box = new THREE.Mesh(HitboxScene.#boxGeometry, material);
        box.scale.set(elem.X, elem.Y, elem.Z);
        box.scale.multiplyScalar(this.#armor.scale);
        bone.getWorldQuaternion(box.quaternion);
        box.rotateX(elem.Rotation.Pitch *  Math.PI / 180 + Math.PI / 2);
        box.rotateY(elem.Rotation.Yaw   *  Math.PI / 180);
        box.rotateZ(elem.Rotation.Roll  * -Math.PI / 180);
        box.position.copy(center);
        scene.add(box);
    }

    #createHitbox(scene, material, hitbox)
    {
        const bone = this.#bones[hitbox.BoneName.toLowerCase()];

        const createSphyl = elem => {
            this.#createSphyl(scene, material, elem, bone);
        }

        const createSphere = elem => {
            this.#createSphere(scene, material, elem, bone);
        }

        const createBox = elem => {
            this.#createBox(scene, material, elem, bone);
        }

        hitbox.AggGeom.SphylElems?.filter(this.#filter)?.forEach(createSphyl);
        hitbox.AggGeom.SphereElems?.filter(this.#filter)?.forEach(createSphere);
        hitbox.AggGeom.BoxElems?.filter(this.#filter)?.forEach(createBox);
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
    #armor;
    #color;
    #opacity;

    #createCollision(scene, material)
    {
        const radius = this.#armor.radius;
        const height = this.#armor.height - radius * 2;
        const geometry = new THREE.CapsuleGeometry(radius, height, 8, 32);
        const capsule = new THREE.Mesh(geometry, material);
        capsule.rotateX(Math.PI / 2);
        scene.add(capsule);
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

    updateRenderTarget()
    {
        super.updateRenderTarget();
        this.updateRenderTargetMaterial();
    }

    createRenderTargetMaterial()
    {
        return new THREE.ShaderMaterial({
            transparent: true,
            uniforms: {
                map: {value: this.renderTarget.texture},
                width: {value: this.renderTarget.width},
                height: {value: this.renderTarget.height},
                opacity: {value: this.#opacity}
            },
            vertexShader: `
                varying vec2 vUv;

                void main() {
                    vUv = uv;
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
            fragmentShader: `
                varying vec2 vUv;

                uniform sampler2D map;
                uniform float width;
                uniform float height;
                uniform float opacity;

                const float PI = 3.1415926538;

                float alpha_test(float x, float y) {
                    const float RADIUS = 0.005;
                    float inv_aspect = height / width;
                    vec2 offset = vec2(x * RADIUS * inv_aspect, y * RADIUS);
                    return texture2D(map, vUv + offset).a;
                }

                void main() {
                    vec4 color = texture2D(map, vUv);

                    if (color.a == 0.0)
                        discard;

                    const int SAMPLES = 8;
                    float neighbor_alpha = 1.0;

                    for (int index = 0; index < SAMPLES; index++) {
                        float angle = float(index) * (1.0/float(SAMPLES)*2.0*PI);
                        neighbor_alpha = min(neighbor_alpha, alpha_test(cos(angle), sin(angle)));
                    }

                    if (neighbor_alpha == 1.0)
                        discard;

                    gl_FragColor = vec4(color.rgb, color.a * opacity * (1.0 - neighbor_alpha));
				}
			`
        });
    }
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

class HitboxCanvas extends HTMLCanvasElement {
    constructor()
    {
        super();

        THREE.Object3D.DEFAULT_UP = new THREE.Vector3(0, 0, 1);

        this.renderer = new THREE.WebGLRenderer({canvas: this, alpha: true, depth: false});
        this.renderer.clear();

        this.cameraRotation = {Pitch: 0, Yaw: 0, Roll: 0};
        this.armor = ARMORS[0];
        this.dragging = false;

        $(this).on("mousedown", ({originalEvent: event}) => {
            if (event.button === 0)
                this.dragging = true;
        });

        $(document).on("mouseup", ({originalEvent: event}) => {
            if (event.button === 0)
                this.dragging = false;
        });

        $(document).on("mousemove", ({originalEvent: event}) => {
            if (!this.dragging || !(event.buttons & 1))
                return;

            const ROTATION_SENSITIVITY = 0.3;

            this.cameraRotation.Yaw   -= event.movementX * ROTATION_SENSITIVITY;
            this.cameraRotation.Pitch += event.movementY * ROTATION_SENSITIVITY;
            this.cameraRotation.Pitch = Math.min(Math.max(this.cameraRotation.Pitch, -89), 89);
            this.#updateCamera();
        });

        const loadScene = index => {
            const resolution = this.getResolution();
            this.armor = ARMORS[index];
            this.camera = new THREE.PerspectiveCamera(20, resolution.x / resolution.y, 0.1, 10000);
            this.#updateCamera();

            this.scene = new CompositeScene(this.armor, this.camera, resolution.x, resolution.y);
            this.renderer.setAnimationLoop(() => this.scene.draw(this.renderer));
        };

        addEventListener("armor-selected", event => loadScene(event.detail.index));

        loadScene(0);

        const updateSize = (width, height) => {
            this.renderer.setDrawingBufferSize(width, height, 1);
            this.camera.aspect = width / height;
            this.camera.updateProjectionMatrix();
            this.scene.resize(width, height);
        };

        new ResizeObserver(entries => {
            for (const entry of entries)
                updateSize(entry.contentRect.width, entry.contentRect.height);
        }).observe(this);

        updateSize($(this).width(), $(this).height());
    }

    getResolution()
    {
        return this.renderer.getDrawingBufferSize(new THREE.Vector2());
    }

    #updateCamera()
    {
        this.camera.position.set(700, 0, 0);
        this.camera.position.applyQuaternion(rotatorToQuaternion(this.cameraRotation));
        this.camera.position.applyEuler(new THREE.Euler(0, 0, -Math.PI / 2));
        // Make offset to bottom of capsule consistent
        const adjust = (BASE_HEIGHT - this.armor.height) / 2;
        this.camera.position.z += adjust;
        this.camera.lookAt(0, 0, adjust);
    }
}

customElements.define("hitbox-canvas", HitboxCanvas, {extends: "canvas"});