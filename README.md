# NEXVOLT — 3D Product Viewer

A cinematic, interactive 3D product showcase built with Three.js and WebGL. Renders three NEXVOLT energy drink variants in real-time with physically-based materials, image-based lighting, a custom GLSL rim-glow shader, and Unreal Engine-style bloom post-processing — entirely in the browser with no server required.

---

## Technologies

| Layer | Technology |
|---|---|
| 3D Rendering | Three.js r128 (WebGL) |
| Post-processing | EffectComposer + UnrealBloomPass |
| Shading | Custom GLSL (Fresnel rim-glow) |
| Lighting | PMREM image-based lighting (IBL) |
| Tone mapping | ACES Filmic |
| Models | GLTF/GLB (Blender exports) |
| Audio | Web Audio API (synthesised, no files) |
| Layout | Vanilla HTML5 + CSS3 custom properties |
| Logic | Vanilla JavaScript (ES5-compatible) |

All Three.js libraries are bundled locally in `js/libs/` — no CDN, no bundler, no build step required.

---

## Features

### 3D Viewer
- **Three product models** — Slim Can, Sport Bottle, Crushed Can (procedural fallback if GLBs absent)
- **Smooth camera presets** — Hero, Side, Top, Detail views with lerp animation
- **OrbitControls** — drag to orbit, scroll to zoom, right-click to pan
- **Auto-rotation** — slow turntable orbit via `controls.autoRotate`
- **Model rotation** — manual ±22.5° step rotation buttons
- **Zoom controls** — 15% step in/out buttons

### Rendering
- **PBR materials** — MeshStandardMaterial with metalness/roughness per-model overrides
- **Image-based lighting** — PMREM studio environment painted onto canvas (no HDR file)
- **ACES filmic tone mapping** — cinematic contrast, exposure 0.95
- **Custom GLSL Fresnel rim shader** — BackSide AdditiveBlending glow, electric cyan (#00e5ff)
- **Unreal Bloom** — EffectComposer post-processing, toggle with strength 0.65 / radius 0.30
- **Wireframe mode** — toggle real-time wireframe on any model
- **Float animation** — gentle sine-wave hover, respects `prefers-reduced-motion`
- **Drop shadow** — radial-gradient plane that scales/fades as the model rises

### Lighting
- Four-point studio setup: ambient, warm key, cool-tinted fill, white rim
- Per-axis intensity slider (0×–3×)
- Studio lights toggle (all lights simultaneously)

### UI / UX
- Full-page loading screen with animated NEXVOLT logo and progress sweep
- Model-switch loading overlay with per-file progress bar
- Model gallery with three product cards linking to the viewer
- Promo video section (`assets/video/promo.mp4`)
- Product information section
- About page (`about.html`) with full technical documentation

### Audio
- Synthesised ambient soundscape (three oscillators, low-pass filtered) — no audio files
- Short tick / rising sweep UI feedback sounds
- Lazy `AudioContext` creation to satisfy browser autoplay policy

### Accessibility (WCAG 2.1 AA)
- Keyboard navigable — all controls reachable via Tab
- `aria-pressed` state on every toggle button
- `aria-label` on all interactive elements
- `aria-live="polite"` region announces model switches and camera presets to screen readers
- `role="region"` / `role="status"` landmarks on viewer and overlays
- Skip-to-main-content link
- `prefers-reduced-motion` respected — float animation disabled, scroll behaviour set to `auto`
- 44×44 px minimum touch targets enforced at all responsive breakpoints

---

## Folder Structure

```
3dapp/
├── index.html              # Main 3D viewer page
├── about.html              # Technical documentation / rubric alignment
├── submission.html         # Submission overview and project summary
├── README.md
│
├── css/
│   └── style.css           # All styles (dark theme, responsive, animations)
│
├── js/
│   ├── script.js           # All Three.js application logic
│   └── libs/               # Local Three.js r128 scripts (no CDN)
│       ├── three.min.js
│       ├── GLTFLoader.js
│       ├── OrbitControls.js
│       ├── EffectComposer.js
│       ├── RenderPass.js
│       ├── UnrealBloomPass.js
│       ├── ShaderPass.js
│       ├── CopyShader.js
│       └── LuminosityHighPassShader.js
│
├── assets/
│   ├── models/             # GLB product models (Blender exports)
│   │   ├── nexvolt_slim_can.glb
│   │   ├── nexvolt_bottle.glb
│   │   └── nexvolt_crushed.glb
│   ├── textures/           # Texture maps (if added)
│   ├── images/             # UI images / screenshots
│   ├── audio/              # Audio files (if added — app uses synthesised audio)
│   └── video/              # Promotional video assets
│       ├── promo.mp4       # Place promotional video here
│       └── promo-poster.jpg
│
├── blender-files/          # Source .blend files for the 3D models
│
└── docs/
    ├── references.txt      # Full references and citations
    ├── originality.txt     # Originality / academic integrity statement
    └── testing-evidence/   # Screenshots and browser test evidence
```

---

## Setup

### Option A — Local server (recommended)

Any static file server works. The simplest options:

**Python (built-in):**
```bash
# Python 3
cd 3dapp
python -m http.server 8080
# then open http://localhost:8080
```

**Node.js (npx):**
```bash
cd 3dapp
npx serve .
# then open the URL shown in the terminal
```

**VS Code:**
Install the *Live Server* extension, right-click `index.html` → *Open with Live Server*.

### Option B — Direct file open

The application runs without a server for most browsers.  
Open `index.html` directly in Chrome or Firefox.

> **Note:** Firefox restricts local file access for GLB loading. Use Option A if models do not appear.

---

## Controls Reference

### Mouse / Touch
| Action | Result |
|---|---|
| Left-drag | Orbit camera |
| Right-drag | Pan camera |
| Scroll wheel | Zoom in / out |
| Pinch (touch) | Zoom in / out |

### Control Panel Buttons
| Button | Action |
|---|---|
| Slim Can / Bottle / Crushed | Switch active product model |
| Auto Rotation | Toggle slow turntable orbit |
| Reset View | Smooth-animate camera to default position |
| Zoom In / Zoom Out | Step zoom 15% per click |
| Hero / Side / Top / Detail | Cinematic camera preset with lerp animation |
| ◀ Left / Right ▶ | Rotate model ±22.5° on Y-axis |
| Wireframe Mode | Toggle wireframe / solid rendering |
| GLSL Rim Shader | Toggle custom Fresnel rim-glow shader |
| Bloom | Toggle Unreal Engine bloom post-processing |
| Studio Lights | Toggle all scene lights |
| Intensity slider | Scale all light intensities 0×–3× |
| Ambient Audio | Toggle synthesised atmospheric soundscape |

---

## Performance Optimisations

- **Pixel ratio cap** — renderer DPR capped at 2× (3× devices render at 2× to avoid 9× pixel cost)
- **GPU memory disposal** — geometries and materials freed on every model switch (`disposeModel()`)
- **Bloom toggle** — routes to `renderer.render()` when bloom is OFF, avoiding EffectComposer overhead
- **PMREM disposal** — environment map generator and source texture disposed immediately after processing
- **Debounced resize** — 100 ms debounce prevents layout thrashing during window drag
- **Page Visibility API** — `requestAnimationFrame` cancelled when tab is hidden, restarted on return
- **Single render loop** — one `animate()` call; Page Visibility API restarts it cleanly
- **Lazy AudioContext** — Web Audio context created only on first user interaction
- **IntersectionObserver** — scroll animations registered once, unobserved after first fire

---

## Shader System

### GLSL Fresnel Rim-Glow

A custom `ShaderMaterial` creates a Fresnel-based glow overlay on every mesh:

**Technique:** A second copy of each mesh is rendered with `THREE.BackSide` at 1.12× scale using `THREE.AdditiveBlending`. The fragment shader computes the dot product of the surface normal and view vector — surfaces at grazing angles (the silhouette edge, facing away from the camera) receive maximum glow intensity; surfaces facing the camera directly receive zero.

```glsl
// Fragment shader core
float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
rim = pow(rim, glowPower);           // controls falloff sharpness
gl_FragColor = vec4(glowColor * rim, rim);
```

- **Colour:** Electric cyan `#00e5ff` — NEXVOLT brand accent
- **Power:** 2.8 — sharp, product-photography-style edge
- **Blending:** AdditiveBlending adds light energy without clipping highlights
- **depthWrite: false** prevents z-fighting with the base geometry

### Unreal Bloom Post-Processing

When enabled, the scene routes through `THREE.EffectComposer`:

```
RenderPass → UnrealBloomPass (strength 0.65, radius 0.30, threshold 0.85) → screen
```

The threshold of 0.85 means only the brightest highlights bloom — metallic specular peaks, the cyan glow overlay — while diffuse surfaces remain clean.

---

## Accessibility Features

- All buttons use native `<button>` elements (not `<div>` or `<a>`) for full keyboard access
- `aria-pressed` updated programmatically on every toggle to reflect current state
- `aria-live="polite"` region (`#sr-announce`) announces: model loading, camera presets, camera reset
- `role="region"` on the viewer container provides a named landmark for screen-reader navigation
- `role="status" aria-live="polite"` on the loading overlays announces loading progress semantically
- `prefers-reduced-motion`: float animation disabled; scroll anchors use `behavior: auto`; CSS animations suppressed

---

## Deployment

The application is a static site — no server-side processing required.

**GitHub Pages:**
1. Push the `3dapp/` folder contents to a repository
2. Enable Pages under *Settings → Pages → Source: main branch / root*
3. Visit `https://<username>.github.io/<repo>/`

**Netlify / Vercel:**
Drag the `3dapp/` folder into the Netlify or Vercel dashboard — auto-deploys with HTTPS.

**USB / Local submission:**
Copy the entire folder. Ensure the relative path structure is preserved. Open `index.html` in Chrome.

---

## Browser Support

| Browser | Status |
|---|---|
| Chrome 90+ | Full support |
| Firefox 88+ | Full support |
| Edge 90+ | Full support |
| Safari 15+ | Full support |
| Mobile Chrome | Full support |
| Mobile Safari | Full support (iOS 15+) |

WebGL 1.0 is required. All target browsers have supported it since 2013.

---

*NEXVOLT is a fictional brand created for educational purposes. All 3D models are original work.*
