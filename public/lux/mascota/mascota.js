/**
 * public/lux/mascota/mascota.js
 *
 * Mascota 2 en el overlay de OBS: el modelo GLB con sus clips, la boca por
 * volumen de la voz, la entrada y salida con GSAP y el render bajo demanda.
 * Requiere Three.js r128 (THREE global) y GSAP (global). Carga GLTFLoader de
 * r128 solo cuando hace falta. La lógica de clips está en logic.js.
 */

import {
  CLIP_SECONDS,
  CROSSFADE_SECONDS,
  EMOTION_CLIP,
  GESTURE_CLIP,
  activeClip,
  emotionOf,
  frameIntervalMs,
  jawOpening,
  renderFps,
} from './logic.js';

/** GLTFLoader de la misma versión que Three.js del overlay (r128). Exacta, no un rango. */
const GLTF_LOADER_SRC = 'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js';

/** Cada cuánto cambia la variante de reposo (Idle1_Base <-> Idle_Var1). */
const IDLE_VARIANT_MS = 6000;

const loadScript = (src) =>
  new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('No se pudo cargar GLTFLoader'));
    document.head.appendChild(script);
  });

async function loadGltf(modelUrl) {
  if (!window.THREE.GLTFLoader) await loadScript(GLTF_LOADER_SRC);
  // Caché del navegador: el archivo se pide una vez; después sale de la caché.
  const res = await fetch(modelUrl, { cache: 'force-cache' });
  if (!res.ok) throw new Error('modelo ' + res.status);
  const buffer = await res.arrayBuffer();
  return new Promise((resolve, reject) => {
    new window.THREE.GLTFLoader().parse(buffer, '', resolve, reject);
  });
}

/**
 * Crea la mascota sobre su canvas. Devuelve la API del overlay: enter(), exit(),
 * setEmotion(), setGesture(), setSpeaking(), setMouth(), resize().
 *
 * @param {{ canvas: HTMLCanvasElement, modelUrl: string, fps60?: boolean, reduceMotion?: boolean, effects?: { shake(): void, flash(): void } | null }} options
 */
export async function createMascota({ canvas, modelUrl, fps60 = false, reduceMotion = false, effects = null }) {
  const T = window.THREE;
  const gsap = window.gsap;
  const gltf = await loadGltf(modelUrl);

  const renderer = new T.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.outputEncoding = T.sRGBEncoding;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(30, 1, 0.1, 100);
  scene.add(new T.AmbientLight(0xffffff, 0.9));
  const sun = new T.DirectionalLight(0xfff5e6, 0.8);
  sun.position.set(1.5, 2.5, 3);
  scene.add(sun);

  const root = new T.Group();
  root.add(gltf.scene);
  scene.add(root);

  // Encuadre: el modelo entero, con la cámara a la altura de su centro.
  const box = new T.Box3().setFromObject(gltf.scene);
  const size = box.getSize(new T.Vector3());
  const center = box.getCenter(new T.Vector3());
  gltf.scene.position.sub(new T.Vector3(center.x, box.min.y, center.z));
  const halfTan = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
  const distance = ((Math.max(size.y, size.x) / 2) * 1.25) / halfTan;
  camera.position.set(0, size.y * 0.5, distance + size.z);
  camera.lookAt(0, size.y * 0.5, 0);

  // Clips: solo los que trae el archivo (el servidor ya quitó el resto).
  const mixer = new T.AnimationMixer(gltf.scene);
  const actions = {};
  for (const clip of gltf.animations) {
    actions[clip.name] = mixer.clipAction(clip);
    actions[clip.name].setLoop(T.LoopRepeat, Infinity);
  }

  // Huesos de la cara: la mandíbula y los labios siguen el volumen de la voz.
  const bones = {};
  gltf.scene.traverse((node) => {
    if (['Jaw', 'L_LowerLip_Mid', 'R_LowerLip_Mid'].includes(node.name)) bones[node.name] = { node, rest: node.rotation.x };
  });

  // Estado. Los tiempos son de performance.now(). Infinity = la emoción dura hasta que cambie.
  let current = null;
  let currentKey = null;
  let emotion = 'normal';
  let emotionUntil = Infinity;
  let gesture = null;
  let gestureUntil = 0;
  let speaking = false;
  let mouth = 0;
  let fadeUntil = 0;
  let entering = false;
  let visible = false;
  let lastTick = 0;
  let idleVariant = 0;
  let idleVariantAt = 0;
  let timer = null;

  const now = () => performance.now();

  /** Clip que debe sonar ahora. La lógica de prioridad está en logic.js (activeClip). */
  function wanted() {
    const t = now();
    const state = activeClip({
      speaking,
      emotion: t < emotionUntil ? emotion : 'normal',
      gesture: t < gestureUntil ? gesture : null,
    });
    let name = state.clip;
    // En reposo, Idle1_Base alterna con Idle_Var1 cada pocos segundos (A1).
    if (name === 'Idle1_Base' && state.timeScale === 1 && !speaking) name = idleVariant % 2 ? 'Idle_Var1' : 'Idle1_Base';
    return { name, timeScale: state.timeScale };
  }

  function playClip(name, timeScale) {
    const key = name + ':' + timeScale;
    if (key === currentKey || !actions[name]) return;
    const next = actions[name];
    next.setEffectiveTimeScale(timeScale);
    next.reset().setEffectiveWeight(1).play();
    if (current && current !== next) current.crossFadeTo(next, CROSSFADE_SECONDS, false); // Cruce de 0,3 s (A2)
    current = next;
    currentKey = key;
    fadeUntil = now() + CROSSFADE_SECONDS * 1000;
    // Efectos de apoyo (A3), solo en Sorprendida (Crit) y en el baile (Dance_Loop).
    if (!reduceMotion && effects) {
      if (name === 'Crit') effects.shake();
      if (name === 'Dance_Loop') effects.flash();
    }
  }

  /** ¿Hay algo en curso que pide fotogramas? Sin voz ni animación, la mascota baja a 5 fps. */
  function busy() {
    const t = now();
    const oneShot = emotionUntil !== Infinity && t < emotionUntil;
    return speaking || entering || t < fadeUntil || t < gestureUntil || oneShot;
  }

  function drawFrame() {
    const t = now();
    if (t >= idleVariantAt) {
      idleVariant += 1;
      idleVariantAt = t + IDLE_VARIANT_MS;
    }
    const { name, timeScale } = wanted();
    playClip(name, timeScale);
    mixer.update(Math.min(0.1, (t - lastTick) / 1000));
    lastTick = t;
    // La mandíbula se suma encima de la animación: sigue el volumen de la voz.
    const open = jawOpening(mouth);
    if (bones.Jaw) bones.Jaw.node.rotation.x = bones.Jaw.rest + open;
    for (const side of ['L_LowerLip_Mid', 'R_LowerLip_Mid']) {
      if (bones[side]) bones[side].node.rotation.x = bones[side].rest + open * 0.4;
    }
    renderer.render(scene, camera);
  }

  /** Bucle con temporizador: 5 fps en reposo, 30 con voz o animación, 60 con el interruptor (R1). */
  function schedule() {
    const fps = renderFps({ busy: busy(), fps60 });
    timer = setTimeout(() => {
      requestAnimationFrame(() => {
        if (timer === null) return;
        if (visible) drawFrame();
        schedule();
      });
    }, frameIntervalMs(fps));
  }

  function start() {
    if (timer !== null) return;
    lastTick = now();
    idleVariantAt = now() + IDLE_VARIANT_MS;
    schedule();
  }

  function stop() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  canvas.style.display = 'none';

  return {
    /** Entrada: aparece con un rebote corto (A2). Con reducir movimiento, aparece sin animar. */
    enter() {
      visible = true;
      canvas.style.display = '';
      resize();
      start();
      if (reduceMotion) return Promise.resolve();
      entering = true;
      root.scale.set(0.85, 0.85, 0.85);
      root.position.y = -0.2;
      return new Promise((resolve) => {
        gsap.timeline({ onComplete: () => { entering = false; resolve(); } })
          .to(root.scale, { x: 1, y: 1, z: 1, duration: 0.55, ease: 'back.out(1.6)' }, 0)
          .to(root.position, { y: 0, duration: 0.55, ease: 'power3.out' }, 0);
      });
    },
    /** Salida: se encoge y deja de dibujar al terminar. */
    exit() {
      const done = () => {
        entering = false;
        visible = false;
        canvas.style.display = 'none';
        stop();
        root.scale.set(1, 1, 1);
        root.position.y = 0;
      };
      if (reduceMotion) {
        done();
        return Promise.resolve();
      }
      entering = true;
      return new Promise((resolve) => {
        gsap.timeline({ onComplete: () => { done(); resolve(); } })
          .to(root.scale, { x: 0.85, y: 0.85, z: 0.85, duration: 0.35, ease: 'power2.in' }, 0)
          .to(root.position, { y: -0.15, duration: 0.35, ease: 'power2.in' }, 0);
      });
    },
    /** Emoción de la respuesta. Las de clip de un solo uso (Alegre, Burlona, Entusiasta, Sorprendida) vuelven a reposo al terminar. */
    setEmotion(id) {
      const mood = emotionOf(id);
      const seconds = CLIP_SECONDS[EMOTION_CLIP[mood].clip];
      emotion = id;
      emotionUntil = seconds ? now() + seconds * 1000 : Infinity;
    },
    /** Gesto del personaje: un solo uso del clip que le toca (mismo mapa que logic.js). */
    setGesture(name) {
      const clip = GESTURE_CLIP[name];
      if (!clip) return;
      gesture = name;
      gestureUntil = now() + (CLIP_SECONDS[clip] || 1.5) * 1000;
    },
    /** La voz suena: Taunt en bucle y la boca sigue el volumen (prioridad sobre la emoción). */
    setSpeaking(on) {
      speaking = Boolean(on);
      if (!speaking) mouth = 0;
    },
    /** Volumen de la voz, de 0 a 1, desde el analizador del audio. */
    setMouth(level) {
      mouth = Number(level) || 0;
    },
    resize,
    /**
     * Libera el modelo: deja de dibujar, para las animaciones y suelta geometrías, materiales,
     * texturas y el renderer. No pierde el contexto WebGL del canvas (el siguiente modelo lo reusa).
     */
    dispose() {
      visible = false;
      stop();
      window.removeEventListener('resize', resize);
      if (gsap) gsap.killTweensOf([root.scale, root.position]);
      mixer.stopAllAction();
      mixer.uncacheRoot(gltf.scene);
      scene.remove(root);
      gltf.scene.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
        for (const material of materials) {
          for (const value of Object.values(material)) {
            if (value && value.isTexture) value.dispose();
          }
          material.dispose();
        }
      });
      renderer.dispose();
      canvas.style.display = 'none';
    },
  };
}
