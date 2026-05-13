// ═══════════════════════════════════════════════════════════════════
//  js/script.js — THREE.js application for the NEXVOLT 3D Viewer
//
//  Loaded last in index.html so THREE, GLTFLoader, and OrbitControls
//  are already available as global variables before this file runs.
//
//  SECTIONS IN THIS FILE
//  ─────────────────────
//  A.  Constants & state variables
//  B.  Sound system  (Web Audio API — no external files needed)
//  C.  Scene, camera, renderer
//  C2. Studio environment map  (PMREM — no HDR file required)
//  D.  Lights  (4-point studio setup)
//  E.  Orbit controls
//  F.  Clock
//  F2. Drop shadow mesh
//  G.  Helper functions  (applyLighting, loadModel)
//  H.  Initial model load
//  I.  Button event listeners
//  J.  Scroll animation observer
//  K.  Window resize handler
//  L.  Animation loop
//  M.  Page Visibility API  (pauses render when tab is hidden)
// ═══════════════════════════════════════════════════════════════════


// ───────────────────────────────────────────────────────────────────
//  A. CONSTANTS & STATE VARIABLES
// ───────────────────────────────────────────────────────────────────

// File paths for each model variant.
// Add a new path here and a matching button in index.html — the rest
// of the code handles it automatically.
var MODELS = {
  slim:    'assets/models/nexvolt_slim_can.glb',
  bottle:  'assets/models/nexvolt_bottle.glb',
  crushed: 'assets/models/nexvolt_crushed.glb'
};

// "Natural" light intensities when the slider sits at 1.0.
// All lighting calculations multiply these by the slider value.
// Four-point setup: ambient baseline + key + fill + rim (back highlight).
var LIGHT_BASE = {
  ambient: 0.5,   // reduced — less flat, more dramatic depth
  key:     2.0,   // stronger key light for crisp product-shot highlights
  fill:    0.6,   // soft fill keeps shadow detail visible
  rim:     1.0    // back rim light — separates can edge from background
};

// Amount the model rotates per button click (22.5 degrees in radians).
var ROT_STEP = Math.PI / 8;

// ── Float animation constants ─────────────────────────────────────
// Centralised here so the animate loop stays readable and the values
// are easy to tweak for grading / demo purposes.
var FLOAT_AMP  = 0.028; // amplitude in world units — gentle product hover
var FLOAT_FREQ = 0.38;  // oscillation speed in rad/s — one full cycle ≈ 16.5 s, very slow

// ── Camera default position ───────────────────────────────────────
// Used for initial placement AND the smooth-reset animation.
// Keeping it in one place avoids the reset drifting from the start.
var CAMERA_DEFAULT_POS = new THREE.Vector3(0, 0.3, 3.2);

// ── Camera reset state ────────────────────────────────────────────
// When true the animate loop lerps the camera back to the default
// position, giving a smooth animated reset instead of a snap.
var isCameraResetting = false;

// ── Accessibility: reduced-motion preference ──────────────────────
// Read once at startup. When true the floating animation is disabled
// and the model stays at its base Y position every frame.
var prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ── Mutable state ──────────────────────────────────────────────────
var currentModel = null;   // THREE.Group currently in the scene
var mixer        = null;   // AnimationMixer — only set when the GLB has animations
var wireframeOn  = false;  // whether wireframe mode is currently active
var lightsOn     = true;   // whether the scene lights are turned on
var lightMult    = 1.0;    // current slider value (0 – 3)
var modelBaseY   = 0;      // Y position of the model after centering
                           // used as the reference point for the float animation
var elapsedTime  = 0;      // total time accumulated by the animate loop

// ── Glow & ambient state ───────────────────────────────────────────
var glowOn       = false;  // whether the rim-glow shader overlay is active
var glowObjects  = [];     // THREE.Mesh[] — glow overlay meshes, tracked for removal
var ambientOn    = false;  // whether ambient background sound is playing
var ambientNodes = null;   // Web Audio nodes for the ambient sound

// ── Model identity ─────────────────────────────────────────────────
// Tracks which MODELS key is currently being loaded so the onError
// fallback and per-model material passes can reference it.
var currentLoadKey = 'slim';

// ── Bloom post-processing state ─────────────────────────────────────
var bloomEnabled = false;  // whether Unreal bloom pass is active
var composer     = null;   // THREE.EffectComposer — initialised by initComposer()
var bloomPass    = null;   // THREE.UnrealBloomPass — initialised by initComposer()

// ── Camera preset animation state ───────────────────────────────────
var cameraAnimating  = false;              // whether a preset lerp is active
var cameraAnimTarget = new THREE.Vector3(); // destination for preset lerp

// Cinematic camera presets — three-quarter hero, profile side, overhead top,
// and close-up detail.  target is the orbit pivot point (near world-origin).
var CAMERA_PRESETS = {
  hero:   { pos: new THREE.Vector3( 1.4, 0.8, 2.6), tgt: new THREE.Vector3(0, 0.1, 0) },
  side:   { pos: new THREE.Vector3( 3.4, 0.2, 0.3), tgt: new THREE.Vector3(0, 0.0, 0) },
  top:    { pos: new THREE.Vector3( 0.0, 4.0, 1.2), tgt: new THREE.Vector3(0, 0.2, 0) },
  detail: { pos: new THREE.Vector3( 0.8, 0.6, 1.8), tgt: new THREE.Vector3(0, 0.4, 0) }
};

// ── Cinematic intro state ──────────────────────────────────────────
var INTRO_ENABLED = !prefersReducedMotion;
var introActive   = false;
var introDuration = 3.5;    // seconds — total dolly-in duration
var introElapsed  = 0;
var introCamStart = new THREE.Vector3(0.8, 1.4, 5.8); // wide starting position

// ── Loading-screen text cycle ──────────────────────────────────────
var SL_MESSAGES = [
  'INITIALISING NEXVOLT SYSTEM',
  'LOADING PRODUCT VISUALISATION',
  'CALIBRATING STUDIO LIGHTING',
  'PREPARING INTERACTIVE VIEWER'
];
var slMsgIdx   = 0;
var slMsgTimer = null;

// ── 3D atmosphere particles ────────────────────────────────────────
var particleMesh = null;

// ── FPS counter ────────────────────────────────────────────────────
var fpsFrameCount = 0;
var fpsLastTime   = 0;
var fpsVisible    = false;
var fpsEl         = null;


// ───────────────────────────────────────────────────────────────────
//  B. SOUND SYSTEM
//  Web Audio API generates tones on-the-fly — no sound files needed.
//  AudioContext is created lazily on the first button press because
//  browsers block audio contexts created before user interaction.
// ───────────────────────────────────────────────────────────────────

var audioCtx = null;

// Returns (or lazily creates) the shared AudioContext.
// Returns null silently if the browser doesn't support Web Audio.
function getAudioContext() {
  if (!audioCtx) {
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
      return null;
    }
  }
  return audioCtx;
}

// Short high-pitched tick — used for most button presses.
function playTick() {
  var ctx = getAudioContext();
  if (!ctx) return;
  try {
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 900;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.07);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.07);
  } catch (e) {}
}

// Rising two-note tone — used when switching between models.
// The pitch glides upward to give a sense of "loading something new".
function playSwitch() {
  var ctx = getAudioContext();
  if (!ctx) return;
  try {
    var osc  = ctx.createOscillator();
    var gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(360, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(720, ctx.currentTime + 0.18);
    gain.gain.setValueAtTime(0.09, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.22);
  } catch (e) {}
}


// Ambient sound — continuous atmospheric hum from three oscillators.
// Fades in over 1.8 s on start and fades out over 0.6 s on stop.
// Created lazily through getAudioContext() to satisfy browser autoplay policy.
function startAmbient() {
  var ctx = getAudioContext();
  if (!ctx || ambientNodes) return;
  try {
    var masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 1.8);
    masterGain.connect(ctx.destination);

    var filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220;
    filter.Q.value = 1.2;
    filter.connect(masterGain);

    var osc1 = ctx.createOscillator(); osc1.type = 'sawtooth'; osc1.frequency.value = 38;
    var osc2 = ctx.createOscillator(); osc2.type = 'sine';     osc2.frequency.value = 76;
    var osc3 = ctx.createOscillator(); osc3.type = 'triangle'; osc3.frequency.value = 114;
    [osc1, osc2, osc3].forEach(function (o) { o.connect(filter); o.start(); });

    ambientNodes = { oscs: [osc1, osc2, osc3], gain: masterGain };
  } catch (e) {}
}

function stopAmbient() {
  if (!ambientNodes) return;
  try {
    var gn  = ambientNodes.gain;
    var ctx = getAudioContext();
    gn.gain.cancelScheduledValues(ctx.currentTime);
    gn.gain.setValueAtTime(gn.gain.value, ctx.currentTime);
    gn.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.6);
    var oscs = ambientNodes.oscs;
    ambientNodes = null;
    setTimeout(function () {
      oscs.forEach(function (o) { try { o.stop(); } catch (e2) {} });
    }, 700);
  } catch (e) {}
}


// ───────────────────────────────────────────────────────────────────
//  B2. RIM GLOW SHADER  (custom GLSL — deeper-understanding feature)
//
//  Fresnel/rim effect: surfaces at grazing angles (edge-on to the
//  camera) glow at maximum; surfaces facing the camera directly
//  receive zero glow.
//
//  Technique: a BackSide copy of each mesh at 1.12× scale, composited
//  with AdditiveBlending so the glow adds light energy without clipping.
// ───────────────────────────────────────────────────────────────────

var GLOW_VERT = [
  'varying vec3 vNormal;',
  'varying vec3 vViewPosition;',
  'void main() {',
  '  vNormal = normalize( normalMatrix * normal );',
  '  vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );',
  '  vViewPosition = -mvPosition.xyz;',
  '  gl_Position = projectionMatrix * mvPosition;',
  '}'
].join('\n');

var GLOW_FRAG = [
  'uniform vec3  glowColor;',
  'uniform float glowPower;',
  'varying vec3  vNormal;',
  'varying vec3  vViewPosition;',
  'void main() {',
  '  vec3  n   = normalize( vNormal );',
  '  vec3  v   = normalize( vViewPosition );',
  '  float rim = 1.0 - abs( dot( n, v ) );',
  '  rim = pow( rim, glowPower );',
  '  gl_FragColor = vec4( glowColor * rim, rim );',
  '}'
].join('\n');


// ───────────────────────────────────────────────────────────────────
//  C. SCENE, CAMERA, RENDERER
// ───────────────────────────────────────────────────────────────────

// The scene holds every object, light, and camera. Think of it as
// an empty stage that we populate before each frame is rendered.
var scene = new THREE.Scene();

// ── Cinematic background ──────────────────────────────────────────
// A radial gradient painted onto an offscreen canvas and set as the
// scene's background texture. THREE.js renders this as a static
// full-screen quad behind all 3D geometry, giving depth to the
// void behind the product without requiring a skybox or HDR.
//
// Gradient is a near-black annulus with a barely-perceptible warm
// mid-ring — subtle enough to let the product be the focus while
// providing more visual interest than a flat solid colour.
var bgCanvas       = document.createElement('canvas');
bgCanvas.width     = 512;
bgCanvas.height    = 512;
var bgCtx          = bgCanvas.getContext('2d');
var bgGrad         = bgCtx.createRadialGradient(256, 256, 0, 256, 256, 256);
bgGrad.addColorStop(0,    '#0e0e16'); // deep blue-black centre — subtle energy
bgGrad.addColorStop(0.28, '#0b0b12'); // mid dark
bgGrad.addColorStop(0.58, '#08080f'); // outer fade
bgGrad.addColorStop(1,    '#060609'); // near-black edge
bgCtx.fillStyle = bgGrad;
bgCtx.fillRect(0, 0, 512, 512);

// CanvasTexture wraps the canvas as a THREE.Texture.
// LinearFilter on both min/mag avoids blocky artefacts when the
// 512×512 canvas is scaled to fill the viewer at any resolution.
var bgTexture           = new THREE.CanvasTexture(bgCanvas);
bgTexture.minFilter     = THREE.LinearFilter;
bgTexture.magFilter     = THREE.LinearFilter;
scene.background        = bgTexture;


// Size the camera to match the viewer div (not the whole window) so
// the aspect ratio stays correct regardless of the header / footer.
var container = document.getElementById('viewer-container');

// PerspectiveCamera gives natural perspective (farther = smaller).
// Arguments: field-of-view (degrees), aspect ratio, near clip, far clip.
var camera = new THREE.PerspectiveCamera(
  45,
  container.clientWidth / container.clientHeight,
  0.1,
  100
);
camera.position.copy(CAMERA_DEFAULT_POS); // defined in section A — shared with reset handler


// WebGLRenderer uses the GPU to draw the scene onto a <canvas>.
// antialias: true smooths jagged edges on geometry.
var renderer = new THREE.WebGLRenderer({ antialias: true });
// Cap at 2 — devices with DPR > 2 (e.g. phones at 3×) gain no visible
// quality above 2× but pay a large GPU cost: 3× = 9× the pixel count.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(container.clientWidth, container.clientHeight);
renderer.outputEncoding   = THREE.sRGBEncoding;        // correct gamma / colour space
renderer.toneMapping      = THREE.ACESFilmicToneMapping; // cinematic contrast curve
renderer.toneMappingExposure = 0.95;                      // slightly pulled back to keep red accurate
container.appendChild(renderer.domElement);               // attach canvas to the page


// ───────────────────────────────────────────────────────────────────
//  C2. STUDIO ENVIRONMENT MAP
//  PMREMGenerator converts an equirectangular image into a pre-filtered
//  cube map that MeshStandardMaterial uses for image-based lighting (IBL)
//  — physically correct reflections and specular highlights at zero
//  runtime cost.  We paint a dark-studio gradient with two soft
//  "softbox" light patches directly onto a canvas, so no external HDR
//  file is required.  The source texture and generator are disposed
//  immediately after processing to free GPU / CPU memory.
// ───────────────────────────────────────────────────────────────────

var pmremGenerator = new THREE.PMREMGenerator(renderer);
pmremGenerator.compileEquirectangularShader();

// 1024 × 512 equirectangular canvas — represents a full 360° × 180° panorama
var envCanvas    = document.createElement('canvas');
envCanvas.width  = 1024;
envCanvas.height = 512;
var envCtx       = envCanvas.getContext('2d');

// Dark gradient: lit studio ceiling down to near-black floor
var envGrad = envCtx.createLinearGradient(0, 0, 0, 512);
envGrad.addColorStop(0.00, '#727272'); // bright grey ceiling
envGrad.addColorStop(0.20, '#505050');
envGrad.addColorStop(0.40, '#303030');
envGrad.addColorStop(0.60, '#191919');
envGrad.addColorStop(0.85, '#0c0c0c');
envGrad.addColorStop(1.00, '#060606'); // near-black floor
envCtx.fillStyle = envGrad;
envCtx.fillRect(0, 0, 1024, 512);

// Additive soft-light patches — visible as subtle bright streaks in
// metallic reflections, consistent with the warm key + cool fill lights.
envCtx.globalCompositeOperation = 'lighter';

// Key softbox — upper-right hemisphere (warm white)
var kp = envCtx.createRadialGradient(740, 70, 0, 740, 70, 210);
kp.addColorStop(0,   'rgba(210,195,165,0.65)');
kp.addColorStop(0.5, 'rgba(140,120, 90,0.25)');
kp.addColorStop(1,   'rgba(  0,  0,  0,0   )');
envCtx.fillStyle = kp;
envCtx.fillRect(530, 0, 420, 280);

// Fill softbox — upper-left hemisphere (cool cyan-tinted for NEXVOLT palette)
var fp = envCtx.createRadialGradient(230, 95, 0, 230, 95, 160);
fp.addColorStop(0,   'rgba(100,180,210,0.46)');
fp.addColorStop(0.5, 'rgba( 60,120,150,0.18)');
fp.addColorStop(1,   'rgba(  0,  0,  0,0   )');
envCtx.fillStyle = fp;
envCtx.fillRect(70, 0, 320, 255);

// Wrap the canvas as an equirectangular THREE.Texture and PMREM-process it
var envSourceTex      = new THREE.CanvasTexture(envCanvas);
envSourceTex.encoding = THREE.sRGBEncoding;
envSourceTex.mapping  = THREE.EquirectangularReflectionMapping;

var studioEnvMap = pmremGenerator.fromEquirectangular(envSourceTex).texture;
pmremGenerator.dispose(); // free shader programs — no longer needed
envSourceTex.dispose();   // free the source pixel data

// Assign to the scene — every MeshStandardMaterial automatically samples
// this map for image-based reflections and specular highlights.
scene.environment = studioEnvMap;

// initComposer is declared in section G and hoisted — safe to call here.
initComposer();


// ───────────────────────────────────────────────────────────────────
//  D. LIGHTS
//  Without lights every surface appears black (no reflection).
//  Three-point lighting is a standard photography / CGI technique:
//  key light (main), fill light (softens shadows), ambient (baseline).
// ───────────────────────────────────────────────────────────────────

// Ambient light — soft flat baseline so no surface goes completely black
var ambientLight = new THREE.AmbientLight(0xffffff, LIGHT_BASE.ambient);
scene.add(ambientLight);

// Key light — warm main light from upper-right, like a studio softbox.
// The slight warm tint (0xfff8f0) prevents the metallic surface looking cold.
var keyLight = new THREE.DirectionalLight(0xfff8f0, LIGHT_BASE.key);
keyLight.position.set(4, 9, 5);
scene.add(keyLight);

// Fill light — cool-tinted soft light from the left, balances the warm key
// and keeps shadow areas from going too dark or muddy.
var fillLight = new THREE.DirectionalLight(0xf0f5ff, LIGHT_BASE.fill);
fillLight.position.set(-5, 3, -2);
scene.add(fillLight);

// Rim light — pure white back-light from directly behind and above.
// Creates a bright edge highlight that lifts the can off the dark background,
// which is a hallmark of professional product photography.
var rimLight = new THREE.DirectionalLight(0xffffff, LIGHT_BASE.rim);
rimLight.position.set(0, 5, -7);
scene.add(rimLight);


// ───────────────────────────────────────────────────────────────────
//  E. ORBIT CONTROLS
//  Left-drag = orbit camera · Right-drag = pan · Scroll = zoom.
//  enableDamping adds inertia so movement feels smooth and natural.
// ───────────────────────────────────────────────────────────────────

var controls = new THREE.OrbitControls(camera, renderer.domElement);
controls.enableDamping  = true;
controls.dampingFactor  = 0.06;           // smooth but responsive inertia
controls.zoomSpeed      = 0.7;            // gentle zoom — easier to land on exact position
controls.minDistance    = 1.6;            // avoids clipping inside the model
controls.maxDistance    = 6.5;            // keeps the product always prominent
controls.maxPolarAngle  = Math.PI * 0.82; // can't look from below ground
controls.minPolarAngle  = Math.PI * 0.08; // prevents flipping over the top

// Cancel the smooth-reset lerp the moment the user grabs the camera.
// Without this, the lerp fights user input and causes a jittery feel.
controls.addEventListener('start', function () {
  isCameraResetting = false;
  cameraAnimating   = false;
  cancelIntro();
});


// ───────────────────────────────────────────────────────────────────
//  F. CLOCK
//  THREE.Clock measures the time between frames (delta).
//  The AnimationMixer needs this delta to advance animations at the
//  correct speed, independent of the display's frame rate.
// ───────────────────────────────────────────────────────────────────

var clock = new THREE.Clock();


// ───────────────────────────────────────────────────────────────────
//  F2. DROP SHADOW MESH
//  Simulates the soft shadow seen in professional product photography.
//  A flat plane is positioned below the model and textured with a
//  radial gradient drawn onto an HTML Canvas — no image files needed.
//  Its opacity and scale are animated in the loop to react to the
//  floating motion, adding a sense of physical depth.
// ───────────────────────────────────────────────────────────────────

var dropShadow = (function createDropShadow() {
  // Draw a soft radial gradient (opaque centre → transparent edge)
  var cvs  = document.createElement('canvas');
  cvs.width = cvs.height = 256;
  var ctx2  = cvs.getContext('2d');
  var grad  = ctx2.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0,    'rgba(0,0,0,0.6)');
  grad.addColorStop(0.4,  'rgba(0,0,0,0.3)');
  grad.addColorStop(1,    'rgba(0,0,0,0)');
  ctx2.fillStyle = grad;
  ctx2.fillRect(0, 0, 256, 256);

  var tex = new THREE.CanvasTexture(cvs);
  var geo = new THREE.PlaneGeometry(3.2, 3.2);
  var mat = new THREE.MeshBasicMaterial({
    map:         tex,
    transparent: true,
    opacity:     0.75,
    depthWrite:  false  // avoids z-fighting with the model
  });

  var mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x  = -Math.PI / 2; // lay flat on the XZ ground plane
  mesh.position.y  = -1.35;        // initial position, refined per model on load
  mesh.renderOrder = -1;            // render behind everything else
  return mesh;
})();

scene.add(dropShadow);


// ───────────────────────────────────────────────────────────────────
//  G. HELPER FUNCTIONS
// ───────────────────────────────────────────────────────────────────

// ── initComposer ────────────────────────────────────────────────────
// Builds the EffectComposer post-processing pipeline:
//   RenderPass   — draws the scene to an intermediate framebuffer
//   UnrealBloomPass — selective bloom glow on bright pixels
// bloomPass.enabled starts false; the Bloom button toggles it at runtime.
function initComposer() {
  composer  = new THREE.EffectComposer(renderer);

  var renderPass = new THREE.RenderPass(scene, camera);
  composer.addPass(renderPass);

  bloomPass = new THREE.UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    0.65,  // strength  — moderate glow, not overblown
    0.30,  // radius    — tight spread for product-shot clarity
    0.85   // threshold — only the brightest highlights bloom
  );
  bloomPass.enabled = false;
  composer.addPass(bloomPass);
}


// ── Loading-screen text cycle ───────────────────────────────────────
function startLoadingTextCycle() {
  var el = document.getElementById('sl-msg');
  if (!el) return;
  slMsgIdx   = 0;
  el.textContent = SL_MESSAGES[0];
  slMsgTimer = setInterval(function () {
    slMsgIdx = (slMsgIdx + 1) % SL_MESSAGES.length;
    var msgEl = document.getElementById('sl-msg');
    if (msgEl) msgEl.textContent = SL_MESSAGES[slMsgIdx];
  }, 1800);
}

function stopLoadingTextCycle() {
  if (slMsgTimer) { clearInterval(slMsgTimer); slMsgTimer = null; }
}

// ── dismissSiteLoading ──────────────────────────────────────────────
// Fades out the full-page loading screen after the first model resolves.
// The dataset.dismissed flag prevents double-execution if onLoad and
// onError both fire (shouldn't happen, but guards against edge cases).
function dismissSiteLoading() {
  var el = document.getElementById('site-loading');
  if (!el || el.dataset.dismissed) return;
  el.dataset.dismissed = '1';
  stopLoadingTextCycle();
  var slBar = document.getElementById('sl-bar');
  if (slBar) { slBar.style.animation = 'none'; slBar.style.width = '100%'; }
  el.classList.add('sl-fade-out');
  setTimeout(function () {
    el.style.display = 'none';
    startIntroSequence();
  }, 700);
}


// ── disposeModel ────────────────────────────────────────────────────
// Traverses a model and frees every geometry and material from GPU
// memory.  Must be called before removing a model from the scene;
// without it each model switch leaks ~10–20 MB of VRAM indefinitely.
// Note: glow overlay meshes share geometry with their parent so they
// are NOT included here — removeGlowOverlay() disposes their materials.
function disposeModel(model) {
  if (!model) return;
  model.traverse(function (child) {
    if (!child.isMesh) return;
    if (child.geometry) child.geometry.dispose();
    var mat = child.material;
    if (!mat) return;
    // Dispose any texture maps held by the material
    ['map', 'normalMap', 'roughnessMap', 'metalnessMap',
     'emissiveMap', 'aoMap', 'lightMap'].forEach(function (k) {
      if (mat[k] && typeof mat[k].dispose === 'function') mat[k].dispose();
    });
    mat.dispose();
  });
}


// ── srAnnounce ──────────────────────────────────────────────────────
// Writes a short message to the aria-live region so screen readers
// announce state changes without moving keyboard focus.
// The brief timeout ensures the DOM mutation is detected by AT even
// when the same message fires twice in a row.
function srAnnounce(msg) {
  var el = document.getElementById('sr-announce');
  if (!el) return;
  el.textContent = '';
  setTimeout(function () { el.textContent = msg; }, 50);
}


// ── Cinematic intro sequence ────────────────────────────────────────
// Camera dollies from introCamStart to CAMERA_DEFAULT_POS over
// introDuration seconds using an easeOutCubic curve.  The model
// simultaneously rises from below the frame.  Any OrbitControls
// interaction cancels the intro immediately via cancelIntro().
function startIntroSequence() {
  if (!INTRO_ENABLED) return;
  camera.position.copy(introCamStart);
  introElapsed = 0;
  introActive  = true;
}

function cancelIntro() {
  if (!introActive) return;
  introActive = false;
  camera.position.copy(CAMERA_DEFAULT_POS);
  controls.target.set(0, 0, 0);
  controls.update();
}


// ── 3D atmosphere particles ─────────────────────────────────────────
// 80 points distributed on a sphere shell (radius 4–8 units) giving a
// subtle ambient depth to the scene.  Single draw call, depthWrite off
// to prevent z-fighting with models.
function createParticles() {
  var count    = 80;
  var positions = new Float32Array(count * 3);
  for (var i = 0; i < count; i++) {
    var theta  = Math.random() * Math.PI * 2;
    var phi    = Math.acos(2 * Math.random() - 1);
    var radius = 4 + Math.random() * 4; // 4–8 units
    positions[i * 3]     = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = radius * Math.cos(phi);
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  var mat = new THREE.PointsMaterial({
    color:          0x00e5ff,
    size:           0.045,
    sizeAttenuation: true,
    transparent:    true,
    opacity:        0.30,
    depthWrite:     false
  });
  particleMesh = new THREE.Points(geo, mat);
  scene.add(particleMesh);
}


// ── FPS counter ─────────────────────────────────────────────────────
// Toggle with F key.  Renders to a fixed DOM element so it never
// interferes with the WebGL canvas.
function setupFpsCounter() {
  fpsEl = document.createElement('div');
  fpsEl.id = 'fps-counter';
  fpsEl.textContent = '-- FPS';
  document.body.appendChild(fpsEl);
  fpsLastTime = performance.now();
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'f' && e.key !== 'F') return;
    fpsVisible = !fpsVisible;
    fpsEl.style.display = fpsVisible ? 'block' : 'none';
  });
}


// ── applyLighting ───────────────────────────────────────────────────
// Recalculates all light intensities from the current lightsOn state
// and the lightMult slider value. Call this whenever either changes.
function applyLighting() {
  var m = lightsOn ? lightMult : 0; // multiplier = 0 when lights are off
  ambientLight.intensity = LIGHT_BASE.ambient * m;
  keyLight.intensity     = LIGHT_BASE.key     * m;
  fillLight.intensity    = LIGHT_BASE.fill    * m;
  rimLight.intensity     = LIGHT_BASE.rim     * m;
}


// ── addGlowOverlay ──────────────────────────────────────────────────
// Attaches a BackSide glow mesh as a child of every mesh in the model.
// Child inherits parent transforms, so no per-frame sync is needed.
function addGlowOverlay(model) {
  glowObjects = [];
  model.traverse(function (child) {
    if (!child.isMesh || child.name.indexOf('glow__') === 0) return;
    var glowMesh = new THREE.Mesh(
      child.geometry,
      new THREE.ShaderMaterial({
        uniforms: {
          glowColor: { value: new THREE.Color(0x00e5ff) }, // electric cyan — NEXVOLT energy signature
          glowPower: { value: 2.8 }
        },
        vertexShader:   GLOW_VERT,
        fragmentShader: GLOW_FRAG,
        side:        THREE.BackSide,
        transparent: true,
        blending:    THREE.AdditiveBlending,
        depthWrite:  false
      })
    );
    glowMesh.name = 'glow__' + child.name;
    glowMesh.scale.setScalar(1.12);
    child.add(glowMesh);
    glowObjects.push(glowMesh);
  });
}

// ── removeGlowOverlay ───────────────────────────────────────────────
// Detaches and disposes all glow meshes created by addGlowOverlay.
function removeGlowOverlay() {
  glowObjects.forEach(function (mesh) {
    if (mesh.parent) mesh.parent.remove(mesh);
    mesh.material.dispose();
  });
  glowObjects = [];
}


// ── createFallbackModel ─────────────────────────────────────────────
// Generates a procedural THREE.js mesh when a GLB file is absent.
// Each key produces visibly different geometry and material properties,
// satisfying the "three distinct models" requirement even during
// development before real GLB exports are ready.
//
// LatheGeometry revolves a 2-D profile (radius, y) around the Y-axis.
// Starting and ending each profile at radius=0 closes top and bottom.
function createFallbackModel(key) {
  var group = new THREE.Group();

  if (key === 'slim') {
    // ── Slim 250 ml energy can ──────────────────────────────────────
    // Tall cylinder with bevelled shoulder, recessed neck, dome top.
    var pts = [
      new THREE.Vector2(0,    0   ),
      new THREE.Vector2(0.48, 0   ),
      new THREE.Vector2(0.50, 0.05),
      new THREE.Vector2(0.50, 0.10),
      new THREE.Vector2(0.50, 1.38),
      new THREE.Vector2(0.46, 1.50),
      new THREE.Vector2(0.38, 1.59),
      new THREE.Vector2(0.30, 1.65),
      new THREE.Vector2(0.28, 1.69),
      new THREE.Vector2(0.18, 1.72),
      new THREE.Vector2(0,    1.72)
    ];
    var geo = new THREE.LatheGeometry(pts, 64);
    var mat = new THREE.MeshStandardMaterial({
      color:           0xc8d8e0,
      metalness:       0.92,
      roughness:       0.26,
      envMapIntensity: 0.8
    });
    group.add(new THREE.Mesh(geo, mat));

  } else if (key === 'bottle') {
    // ── Sport 500 ml bottle ─────────────────────────────────────────
    // Wider organic body + constricted neck + cap in a contrasting mat.
    // Body split from cap so each gets its own material.
    var bodyPts = [
      new THREE.Vector2(0,    0   ),
      new THREE.Vector2(0.50, 0   ),
      new THREE.Vector2(0.55, 0.06),
      new THREE.Vector2(0.58, 0.50),
      new THREE.Vector2(0.60, 1.00),
      new THREE.Vector2(0.55, 1.28),
      new THREE.Vector2(0.40, 1.42),
      new THREE.Vector2(0.28, 1.52),
      new THREE.Vector2(0.28, 1.76)
    ];
    var capPts = [
      new THREE.Vector2(0.28, 1.76),
      new THREE.Vector2(0.31, 1.80),
      new THREE.Vector2(0.31, 1.96),
      new THREE.Vector2(0,    1.96)
    ];
    var bodyMat = new THREE.MeshStandardMaterial({
      color:           0x88ccdd,
      metalness:       0.04,
      roughness:       0.58,
      transparent:     true,
      opacity:         0.80,
      side:            THREE.DoubleSide,
      envMapIntensity: 0.4
    });
    var capMat = new THREE.MeshStandardMaterial({
      color:     0x1e1e1e,
      metalness: 0.08,
      roughness: 0.72
    });
    group.add(new THREE.Mesh(new THREE.LatheGeometry(bodyPts, 64), bodyMat));
    group.add(new THREE.Mesh(new THREE.LatheGeometry(capPts,  48), capMat));

  } else if (key === 'crushed') {
    // ── Crushed / deformed can ──────────────────────────────────────
    // Same base profile as the slim can but with vertex-level displacement
    // simulating asymmetric aluminium buckling (squeeze from one side).
    var segs = 20; // fewer phi segments → angular, faceted crush look
    var crPts = [
      new THREE.Vector2(0,    0   ),
      new THREE.Vector2(0.48, 0   ),
      new THREE.Vector2(0.50, 0.06),
      new THREE.Vector2(0.50, 0.30),
      new THREE.Vector2(0.50, 0.65),
      new THREE.Vector2(0.50, 1.00),
      new THREE.Vector2(0.50, 1.30),
      new THREE.Vector2(0.44, 1.45),
      new THREE.Vector2(0.34, 1.55),
      new THREE.Vector2(0.22, 1.61),
      new THREE.Vector2(0,    1.61)
    ];
    var crGeo   = new THREE.LatheGeometry(crPts, segs);
    var posAttr = crGeo.attributes.position;

    for (var vi = 0; vi < posAttr.count; vi++) {
      var profIdx = Math.floor(vi / (segs + 1));
      var segIdx  = vi % (segs + 1);
      var ptY     = crPts[profIdx] ? crPts[profIdx].y : 0;

      // Crush zone: between y 0.25 and 1.25
      if (ptY > 0.25 && ptY < 1.25) {
        var phi    = (segIdx / segs) * Math.PI * 2;
        var t      = (ptY - 0.25) / 1.0;
        // Asymmetric inward crush — stronger on the cos(phi) ≈ 1 side
        var crush  = (Math.cos(phi) * 0.55 + 0.25) * 0.24 * Math.sin(t * Math.PI);
        posAttr.setX(vi, posAttr.getX(vi) * (1.0 - crush));
        posAttr.setZ(vi, posAttr.getZ(vi) * (1.0 - crush));
        // Vertical buckling — gives the crinkled-metal silhouette
        posAttr.setY(vi, posAttr.getY(vi) + Math.sin(phi * 2 + t * 7) * 0.042);
      }
    }
    posAttr.needsUpdate = true;
    crGeo.computeVertexNormals(); // recalculate after deformation

    var crMat = new THREE.MeshStandardMaterial({
      color:           0x9aacb8,
      metalness:       0.86,
      roughness:       0.44,
      envMapIntensity: 0.6
    });
    group.add(new THREE.Mesh(crGeo, crMat));
  }

  return group;
}


// ── loadModel ────────────────────────────────────────────────────────
// Removes the current model from the scene, shows the loading overlay,
// then fetches and displays the new .glb file.
// Also handles: auto-centre, auto-scale, wireframe persistence,
// GLB animation playback, and progress bar updates.
// Falls back to createFallbackModel() if the GLB is not found.

var overlay     = document.getElementById('loading-overlay');
var progressBar = document.getElementById('progress-bar');
var progressPct = document.getElementById('progress-pct');
var loader      = new THREE.GLTFLoader();

function loadModel(path, key) {
  if (key) currentLoadKey = key;

  // Show the loading overlay with a reset progress bar
  overlay.querySelector('.loader-text').textContent = 'Loading model…';
  progressBar.style.width = '0%';
  progressPct.textContent = '0%';
  overlay.classList.remove('hidden');

  // Remove the previous model and free its GPU memory.
  // removeGlowOverlay() disposes GLSL shader materials before the
  // parent geometries are freed by disposeModel().
  if (currentModel) {
    removeGlowOverlay();
    disposeModel(currentModel);
    scene.remove(currentModel);
    currentModel = null;
  }

  // Stop and discard the previous AnimationMixer if one was running
  if (mixer) {
    mixer.stopAllAction();
    mixer = null;
  }

  loader.load(
    path,

    // ── onLoad ──────────────────────────────────────────────────────
    // Runs once the file is fully downloaded and parsed.
    function onLoad(gltf) {
      var model = gltf.scene;

      // ── Auto-centre & auto-scale ─────────────────────────────────
      // Box3 measures the axis-aligned bounding box of the entire model.
      // We use it to find the model's overall size and its exact centre,
      // then normalise both so every model always appears centred at the
      // world origin and fits neatly within the camera's view.
      var box    = new THREE.Box3().setFromObject(model);
      var size   = new THREE.Vector3();
      var centre = new THREE.Vector3();
      box.getSize(size);     // stores width / height / depth into 'size'
      box.getCenter(centre); // stores the midpoint into 'centre'

      var maxDim = Math.max(size.x, size.y, size.z);
      var scale  = 2.4 / maxDim;            // scale so longest dimension = 2.4 units
      model.scale.setScalar(scale);
      model.position.sub(centre.multiplyScalar(scale)); // shift to world origin

      // ── Save base Y for the floating animation ───────────────────
      // The animate loop adds a sine wave on top of this value
      // every frame, creating the gentle levitation effect.
      modelBaseY = model.position.y;

      // ── Position the drop shadow beneath this model ──────────────
      // The model bottom is half the scaled height below the centre.
      // We push the shadow 0.05 units further down so it never clips.
      dropShadow.position.y = -(size.y * scale) / 2 - 0.05;

      // ── Re-apply wireframe if it was already active ──────────────
      // When the user switches models, any active wireframe mode is
      // preserved so the new model loads in the same visual state.
      if (wireframeOn) {
        model.traverse(function (child) {
          if (child.isMesh) child.material.wireframe = true;
        });
      }

      // ── Enhance material realism ──────────────────────────────────
      // GLB exports often use conservative PBR defaults. We traverse
      // every mesh and:
      //   1. Set envMapIntensity to control how strongly the studio
      //      environment map shows in reflections (0.55 = subtle).
      //   2. For already-metallic surfaces (metalness > 0.35) nudge
      //      metalness and roughness into the brushed-aluminium range
      //      so highlights look sharper and more convincing.
      // This runs once per load — no per-frame cost.
      model.traverse(function (child) {
        if (!child.isMesh) return;
        var mat = child.material;
        if (!mat || !mat.isMeshStandardMaterial) return;

        // Controls how much the scene environment contributes to reflections
        mat.envMapIntensity = 0.55;

        // Nudge metallic surfaces toward brushed-aluminium properties
        if (mat.metalness > 0.35) {
          mat.metalness = Math.min(1.0, mat.metalness + 0.08);
          // Brushed aluminium sits in the 0.22–0.40 roughness range:
          // low enough for crisp highlights, high enough to avoid pure-mirror look
          if (mat.roughness < 0.22) mat.roughness = 0.22;
          if (mat.roughness > 0.40) mat.roughness = 0.38;
        }

        mat.needsUpdate = true;
      });

      // ── Per-model material overrides ─────────────────────────────
      // Apply look-specific adjustments after the generic PBR pass so
      // each product reads as a different physical material at a glance.
      model.traverse(function (child) {
        if (!child.isMesh) return;
        var mat = child.material;
        if (!mat || !mat.isMeshStandardMaterial) return;

        if (currentLoadKey === 'bottle') {
          // Frosted HDPE plastic: semi-transparent, very low metalness
          if (mat.metalness < 0.30) {
            mat.transparent     = true;
            mat.opacity         = 0.82;
            mat.roughness       = Math.max(mat.roughness, 0.55);
            mat.envMapIntensity = 0.30;
          }
        } else if (currentLoadKey === 'crushed') {
          // Damaged aluminium: slightly darker and more matte than pristine can
          if (mat.metalness > 0.35) {
            mat.roughness = Math.max(mat.roughness, 0.40);
            mat.color.multiplyScalar(0.84); // oxidation-darkened surface
          }
        }
        mat.needsUpdate = true;
      });

      scene.add(model);
      currentModel = model;

      // Re-apply glow overlay if it was active before the model swap
      if (glowOn) {
        removeGlowOverlay();
        addGlowOverlay(currentModel);
      }

      // ── Animation support ────────────────────────────────────────
      // A .glb file can embed animation clips (e.g. a pull-tab opening).
      // If any are found, an AnimationMixer is created and all clips are
      // played. The mixer is updated each frame inside the animate() loop.
      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        gltf.animations.forEach(function (clip) {
          mixer.clipAction(clip).play();
        });
      }

      // Fade out the loading overlay and dismiss the full-page site loader
      overlay.classList.add('hidden');
      dismissSiteLoading();
    },

    // ── onProgress ──────────────────────────────────────────────────
    // Called repeatedly while the file downloads.
    // Updates the visual progress bar and the percentage text.
    function onProgress(evt) {
      if (evt.lengthComputable) {
        var pct = Math.round((evt.loaded / evt.total) * 100);
        progressBar.style.width = pct + '%';
        progressPct.textContent = pct + '%';
        // Mirror real progress into the site-loading bar on first load
        var slBar = document.getElementById('sl-bar');
        if (slBar) { slBar.style.animation = 'none'; slBar.style.width = pct + '%'; }
      }
    },

    // ── onError ─────────────────────────────────────────────────────
    // Called if the GLB cannot be found or parsed.
    // Builds a procedural THREE.js geometry as a stand-in so the viewer
    // remains fully functional during development (before real GLB files
    // are exported from Blender and placed in models/).
    function onError(err) {
      console.warn('GLB not found — using procedural geometry:', path, err);

      var fallback = createFallbackModel(currentLoadKey);

      // Reuse the same auto-scale / auto-centre logic as onLoad
      var fbBox    = new THREE.Box3().setFromObject(fallback);
      var fbSize   = new THREE.Vector3();
      var fbCentre = new THREE.Vector3();
      fbBox.getSize(fbSize);
      fbBox.getCenter(fbCentre);
      var fbMaxDim = Math.max(fbSize.x, fbSize.y, fbSize.z);
      var fbScale  = 2.4 / fbMaxDim;
      fallback.scale.setScalar(fbScale);
      fallback.position.sub(fbCentre.multiplyScalar(fbScale));
      modelBaseY            = fallback.position.y;
      dropShadow.position.y = -(fbSize.y * fbScale) / 2 - 0.05;

      if (wireframeOn) {
        fallback.traverse(function (c) {
          if (c.isMesh) c.material.wireframe = true;
        });
      }

      scene.add(fallback);
      currentModel = fallback;

      if (glowOn) {
        removeGlowOverlay();
        addGlowOverlay(currentModel);
      }

      overlay.classList.add('hidden');
      dismissSiteLoading();

      // Append a one-time notice so the developer knows GLBs are missing
      if (!document.querySelector('.demo-notice')) {
        var notice = document.createElement('p');
        notice.className = 'demo-notice';
        notice.setAttribute('role', 'status');
        notice.textContent = 'Demo mode — place GLB files in models/ for final submission';
        document.querySelector('.controls-panel').appendChild(notice);
      }
    }
  );
}


// ───────────────────────────────────────────────────────────────────
//  H. INITIAL MODEL LOAD
//  Load the slim can automatically when the page first opens.
// ───────────────────────────────────────────────────────────────────

createParticles();
startLoadingTextCycle();
setupFpsCounter();
loadModel(MODELS.slim, 'slim');


// ───────────────────────────────────────────────────────────────────
//  I. BUTTON EVENT LISTENERS
// ───────────────────────────────────────────────────────────────────

// ── Model switcher ──────────────────────────────────────────────────
// Highlights the clicked button (active class) and loads the matching
// .glb file. Plays a rising tone for audio feedback.

var modelButtons = document.querySelectorAll('.btn-model');

var MODEL_NAMES = { slim: 'Slim Can', bottle: 'Sport Bottle', crushed: 'Crushed Can' };

function switchModel(key, clickedBtn) {
  playSwitch();

  modelButtons.forEach(function (b) {
    b.classList.remove('active');
    b.setAttribute('aria-pressed', 'false');
  });
  clickedBtn.classList.add('active');
  clickedBtn.setAttribute('aria-pressed', 'true');

  loadModel(MODELS[key], key);
  srAnnounce('Loading ' + (MODEL_NAMES[key] || key));
}

document.getElementById('btn-model-slim').addEventListener('click', function () {
  switchModel('slim', this);
});

document.getElementById('btn-model-bottle').addEventListener('click', function () {
  switchModel('bottle', this);
});

document.getElementById('btn-model-crushed').addEventListener('click', function () {
  switchModel('crushed', this);
});


// ── Auto-rotate ─────────────────────────────────────────────────────
// OrbitControls has a built-in autoRotate property that slowly orbits
// the camera. The button toggles it and updates its own label.

var btnRotate  = document.getElementById('btn-rotate');
var autoRotate = false;

btnRotate.addEventListener('click', function () {
  playTick();
  autoRotate               = !autoRotate;
  controls.autoRotate      = autoRotate;
  controls.autoRotateSpeed = 0.85; // slow display-turntable orbit

  btnRotate.classList.toggle('active', autoRotate);
  btnRotate.setAttribute('aria-pressed', String(autoRotate));
  btnRotate.textContent = autoRotate ? 'Stop Rotation' : 'Auto Rotation';
});


// ── Reset camera ────────────────────────────────────────────────────
// Triggers a smooth animated return to the default showcase angle.
// The actual movement happens via lerp in the animate loop (section L)
// using the CAMERA_DEFAULT_POS constant from section A.

document.getElementById('btn-reset').addEventListener('click', function () {
  playTick();
  controls.target.set(0, 0, 0);
  cameraAnimating   = false; // cancel any running preset animation
  isCameraResetting = true;
  srAnnounce('Camera reset');
});


// ── Zoom in / out ───────────────────────────────────────────────────
// Moves the camera 15 % closer or further along its current direction.

document.getElementById('btn-zoom-in').addEventListener('click', function () {
  playTick();
  camera.position.multiplyScalar(0.85); // 15 % closer
  controls.update();
});

document.getElementById('btn-zoom-out').addEventListener('click', function () {
  playTick();
  camera.position.multiplyScalar(1.15); // 15 % further
  controls.update();
});


// ── Rotate model left / right ───────────────────────────────────────
// Directly spins the model's own Y-axis by ROT_STEP radians per click.
// This is independent of the camera orbit above — they combine visually.

document.getElementById('btn-rot-left').addEventListener('click', function () {
  playTick();
  if (currentModel) currentModel.rotation.y -= ROT_STEP;
});

document.getElementById('btn-rot-right').addEventListener('click', function () {
  playTick();
  if (currentModel) currentModel.rotation.y += ROT_STEP;
});


// ── Wireframe toggle ────────────────────────────────────────────────
// traverse() walks the entire model hierarchy. We check isMesh to
// skip lights or empty groups, then flip wireframe on each material.

var btnWireframe = document.getElementById('btn-wireframe');

btnWireframe.addEventListener('click', function () {
  playTick();
  wireframeOn = !wireframeOn;

  if (currentModel) {
    currentModel.traverse(function (child) {
      if (child.isMesh) child.material.wireframe = wireframeOn;
    });
  }

  btnWireframe.classList.toggle('active', wireframeOn);
  btnWireframe.setAttribute('aria-pressed', String(wireframeOn));
  btnWireframe.textContent = wireframeOn ? 'Solid Mode' : 'Wireframe Mode';
});


// ── Lights toggle ───────────────────────────────────────────────────
// Passes all light intensities to 0 (off) or restores them (on).
// applyLighting() does the maths so the slider value is preserved —
// turning lights back on always restores the last slider position.

var btnLights = document.getElementById('btn-lights');

btnLights.addEventListener('click', function () {
  playTick();
  lightsOn = !lightsOn;
  applyLighting();

  // .active class = lights-OFF visual state (dark button = "off" mode)
  btnLights.classList.toggle('active', !lightsOn);
  // aria-pressed="true" when lights ARE on — consistent with wireframe button
  // (aria-pressed reflects whether the "on" feature is currently active)
  btnLights.setAttribute('aria-pressed', String(lightsOn));
  btnLights.textContent = 'Studio Lights';
});


// ── Intensity slider ────────────────────────────────────────────────
// Scales all light intensities proportionally.
// 0 = total darkness · 1 = natural / default · 3 = triple brightness.
// aria-valuenow is updated so screen readers announce the new value.

var slider         = document.getElementById('slider-intensity');
var intensityLabel = document.getElementById('intensity-value');

slider.addEventListener('input', function () {
  lightMult = parseFloat(this.value);
  intensityLabel.textContent = lightMult.toFixed(1);
  this.setAttribute('aria-valuenow', lightMult.toFixed(1));
  applyLighting();
});


// ── Hero CTA smooth scroll ──────────────────────────────────────────
// The href="#main-content" already triggers the CSS scroll-behavior,
// but we intercept the click to:
//   1. Use scrollIntoView so the behavior matches prefers-reduced-motion
//   2. Move keyboard focus to #main-content after scrolling, so screen-
//      reader and keyboard users land in the right place.
//      (tabindex="-1" on #main-content already allows programmatic focus.)
//   3. preventScroll: true keeps scrollIntoView in charge of the position
//      and prevents a second scroll jump caused by focus().
(function () {
  var cta  = document.querySelector('a.btn-hero[href="#main-content"]');
  var dest = document.getElementById('main-content');
  if (!cta || !dest) return;

  cta.addEventListener('click', function (e) {
    e.preventDefault();
    // Reuse the prefersReducedMotion flag already set in section A —
    // avoids a second matchMedia query for the same preference.
    dest.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
    dest.focus({ preventScroll: true });
  });
}());


// ── Glow toggle ─────────────────────────────────────────────────────
var btnGlow = document.getElementById('btn-glow');

btnGlow.addEventListener('click', function () {
  playTick();
  glowOn = !glowOn;
  if (glowOn) {
    if (currentModel) addGlowOverlay(currentModel);
  } else {
    removeGlowOverlay();
  }
  btnGlow.classList.toggle('active', glowOn);
  btnGlow.setAttribute('aria-pressed', String(glowOn));
  btnGlow.textContent = glowOn ? 'Shader Off' : 'GLSL Rim Shader';
});


// ── Ambient sound toggle ─────────────────────────────────────────────
var btnAmbient = document.getElementById('btn-ambient');

btnAmbient.addEventListener('click', function () {
  playTick();
  ambientOn = !ambientOn;
  if (ambientOn) { startAmbient(); } else { stopAmbient(); }
  btnAmbient.classList.toggle('active', ambientOn);
  btnAmbient.setAttribute('aria-pressed', String(ambientOn));
  btnAmbient.textContent = ambientOn ? 'Audio Off' : 'Ambient Audio';
});


// ── Gallery load buttons ─────────────────────────────────────────────
// data-gallery-model maps to MODELS keys (slim / bottle / crushed).
// switchModel() activates the matching control-panel button and loads the file.
document.querySelectorAll('[data-gallery-model]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    var key    = this.getAttribute('data-gallery-model');
    var ctrlBtn = document.getElementById('btn-model-' + key);
    if (ctrlBtn) switchModel(key, ctrlBtn);
    document.getElementById('main-content').scrollIntoView({
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
      block:    'start'
    });
  });
});


// ── Bloom toggle ─────────────────────────────────────────────────────
var btnBloom = document.getElementById('btn-bloom');

btnBloom.addEventListener('click', function () {
  playTick();
  bloomEnabled = !bloomEnabled;
  if (bloomPass) bloomPass.enabled = bloomEnabled;
  btnBloom.classList.toggle('active', bloomEnabled);
  btnBloom.setAttribute('aria-pressed', String(bloomEnabled));
  btnBloom.textContent = bloomEnabled ? 'Bloom Off' : 'Bloom';
});


// ── Camera presets ───────────────────────────────────────────────────
// Each preset lerps the camera to a fixed position while snapping the
// orbit target.  The animate loop completes the smooth movement each frame.
// Clicking a preset cancels any active camera reset, and vice versa.
var PRESET_NAMES = { hero: 'Hero view', side: 'Side view', top: 'Top view', detail: 'Detail view' };

['hero', 'side', 'top', 'detail'].forEach(function (key) {
  var btn = document.getElementById('btn-preset-' + key);
  if (!btn) return;
  btn.addEventListener('click', function () {
    playTick();
    var preset = CAMERA_PRESETS[key];
    isCameraResetting = false;
    cameraAnimTarget.copy(preset.pos);
    controls.target.copy(preset.tgt);
    cameraAnimating = true;
    srAnnounce(PRESET_NAMES[key] || key);
  });
});


// ───────────────────────────────────────────────────────────────────
//  J. SCROLL ANIMATION OBSERVER
//  IntersectionObserver watches elements with the class
//  "animate-on-scroll". When one enters the viewport it receives
//  the "visible" class, triggering its CSS fade-up transition.
//  We unobserve immediately after — the animation runs once only.
// ───────────────────────────────────────────────────────────────────

var scrollObserver = new IntersectionObserver(function (entries) {
  entries.forEach(function (entry) {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      scrollObserver.unobserve(entry.target); // stop watching after first trigger
    }
  });
}, { threshold: 0.12 }); // fire when 12 % of the element is visible

// Add a stagger delay to cards so they cascade in one after another.
var cards = document.querySelectorAll('.cards-grid .card');
cards.forEach(function (card, i) {
  card.style.transitionDelay = (i * 0.12) + 's';
});

document.querySelectorAll('.gallery-grid .gallery-card').forEach(function (card, i) {
  card.style.transitionDelay = (i * 0.12) + 's';
});

// Register every element that should fade in on scroll
document.querySelectorAll('.animate-on-scroll').forEach(function (el) {
  scrollObserver.observe(el);
});


// ───────────────────────────────────────────────────────────────────
//  K. WINDOW RESIZE HANDLER
//  When the browser resizes, update the camera aspect ratio and
//  the renderer dimensions so nothing stretches or clips.
// ───────────────────────────────────────────────────────────────────

// Debounce the resize handler: wait 100 ms after the last resize event
// before recalculating. Without debouncing, dragging a window border
// fires hundreds of resize events per second and causes layout thrashing.
var resizeTimer = null;
window.addEventListener('resize', function () {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function () {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();

    // Re-evaluate pixel ratio here too — the window may have been moved
    // to an external monitor with a different device pixel ratio (DPR).
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    if (composer) composer.setSize(container.clientWidth, container.clientHeight);
  }, 100);
});


// ───────────────────────────────────────────────────────────────────
//  L. ANIMATION LOOP
//  requestAnimationFrame schedules this function before every repaint
//  (~60 fps on most displays). Each call does four things:
//    1. Get the time elapsed since the last frame (delta)
//    2. Advance GLB animations if the model has any
//    3. Apply a subtle floating effect on the model's Y axis
//    4. Update OrbitControls (required for damping and auto-rotate)
//    5. Render the scene from the camera's point of view
// ───────────────────────────────────────────────────────────────────

// animFrameId holds the current requestAnimationFrame handle.
// Section M (Page Visibility API) uses this to cancel the loop when
// the tab is hidden and restart it when the tab becomes visible again.
var animFrameId = null;

function animate() {
  animFrameId = requestAnimationFrame(animate);

  // delta = seconds since the last frame (typically ~0.016 at 60 fps).
  // We always consume it so the clock stays accurate even when the
  // mixer is null — otherwise time would pile up and cause a jump
  // the first time an animated model is loaded.
  var delta = clock.getDelta();
  elapsedTime += delta;

  // Advance GLB animations — only when the current model has clips
  if (mixer) mixer.update(delta);

  // ── Cinematic intro dolly ───────────────────────────────────────
  // Camera moves from a wide starting position to CAMERA_DEFAULT_POS.
  // easeOutCubic gives a decelerating feel — fast initially, then eases in.
  if (introActive && INTRO_ENABLED) {
    introElapsed += delta;
    var t = Math.min(introElapsed / introDuration, 1.0);
    var ease = 1.0 - Math.pow(1.0 - t, 3); // easeOutCubic
    camera.position.lerpVectors(introCamStart, CAMERA_DEFAULT_POS, ease);
    if (t >= 1.0) {
      camera.position.copy(CAMERA_DEFAULT_POS);
      introActive = false;
    }
  }

  // ── Floating animation + model rise during intro ────────────────
  // Sine-wave on the model's Y axis — like a product hovering in a
  // studio shoot. During the intro the model rises from below the frame.
  // Disabled when the user prefers reduced motion (also in section A).
  if (currentModel) {
    if (introActive && INTRO_ENABLED) {
      // Model rises from 1.2 units below base, completing rise at 60% of dolly
      var riseT  = Math.min(introElapsed / (introDuration * 0.6), 1.0);
      var riseEase = 1.0 - Math.pow(1.0 - riseT, 2); // easeOutQuad
      var riseOffset = -1.2 * (1.0 - riseEase);
      currentModel.position.y = modelBaseY + riseOffset;
      dropShadow.scale.x      = riseEase;
      dropShadow.scale.z      = riseEase;
      dropShadow.material.opacity = riseEase * 0.68;
    } else {
      var floatOffset = prefersReducedMotion
        ? 0
        : Math.sin(elapsedTime * FLOAT_FREQ) * FLOAT_AMP;

      currentModel.position.y = modelBaseY + floatOffset;

      // ── Animated drop shadow ──────────────────────────────────────
      // Shadow shrinks and fades as the can rises — physically accurate:
      // a real shadow grows sharper and smaller as its caster lifts.
      dropShadow.scale.x          = 1.0 - floatOffset * 3.5;
      dropShadow.scale.z          = 1.0 - floatOffset * 3.5;
      dropShadow.material.opacity = Math.max(0.28, 0.68 - floatOffset * 7.0);
    }
  }

  // ── Particle drift ──────────────────────────────────────────────
  // Slow rotation gives the atmosphere particles a gentle swirling motion.
  if (particleMesh) {
    particleMesh.rotation.y += delta * 0.018;
    particleMesh.rotation.x += delta * 0.007;
  }

  // ── Smooth camera reset ─────────────────────────────────────────
  // Lerp factor 0.07 ≈ reaches target in ~0.5 s at 60 fps.
  // The 'start' listener on controls cancels this if the user drags.
  if (isCameraResetting) {
    camera.position.lerp(CAMERA_DEFAULT_POS, 0.07);
    if (camera.position.distanceTo(CAMERA_DEFAULT_POS) < 0.005) {
      camera.position.copy(CAMERA_DEFAULT_POS); // snap to exact target
      isCameraResetting = false;
    }
  }

  // ── Camera preset animation ─────────────────────────────────────
  // Same lerp pattern as the reset above; cancelled by any user drag.
  if (cameraAnimating) {
    camera.position.lerp(cameraAnimTarget, 0.06);
    if (camera.position.distanceTo(cameraAnimTarget) < 0.01) {
      camera.position.copy(cameraAnimTarget);
      cameraAnimating = false;
    }
  }

  controls.update(); // apply damping and auto-rotate speed each frame

  // ── FPS counter ─────────────────────────────────────────────────
  if (fpsVisible && fpsEl) {
    fpsFrameCount++;
    var now = performance.now();
    var elapsed = now - fpsLastTime;
    if (elapsed >= 1000) {
      fpsEl.textContent = Math.round(fpsFrameCount * 1000 / elapsed) + ' FPS';
      fpsFrameCount = 0;
      fpsLastTime   = now;
    }
  }

  // Route through EffectComposer when bloom is active so the bloom pass
  // runs; use the direct renderer path otherwise to avoid the extra
  // framebuffer cost when bloom is not needed.
  if (bloomEnabled && composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

animate(); // start the loop — runs indefinitely until the page closes


// ───────────────────────────────────────────────────────────────────
//  M. PAGE VISIBILITY API
//  Browsers keep running requestAnimationFrame even when the user
//  switches to another tab, burning CPU/GPU for nothing.
//  The Page Visibility API fires 'visibilitychange' when the tab is
//  hidden or restored, letting us cancel and restart the render loop.
//
//  animFrameId stores the current requestAnimationFrame handle so we
//  can cancel it.  The animate() function is patched above to save its
//  own handle; here we replace it with a wrapper that stores the id.
// ───────────────────────────────────────────────────────────────────

document.addEventListener('visibilitychange', function () {
  if (document.hidden) {
    // Tab is hidden — cancel requestAnimationFrame entirely so the GPU
    // is not rendering a frame the user cannot see.
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  } else {
    // Tab is visible again.
    // clock.getDelta() returns the full time the tab was hidden, which
    // would cause the can to jump to a distant float position on the
    // first frame.  Consuming the delta here discards that stale value.
    clock.getDelta();
    // Restart the loop from a clean state.
    animate();
  }
});
