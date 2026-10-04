// The renderer and its finishing: bloom for lamps and the sun's glints, then
// one pass that blurs the screen's edges with speed, darkens its corners and
// flashes on a hit, then the tone map. Sized to the page at devicePixelRatio.
import * as THREE from "./vendor/three.js";
import { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass } from "./vendor/three.js";

export class Renderer {
  gl: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  private composer: EffectComposer;
  private pass: RenderPass;
  private finish: ShaderPass;
  bloom: UnrealBloomPass;

  constructor(canvas: HTMLCanvasElement) {
    const gl = (this.gl = new THREE.WebGLRenderer({ canvas, powerPreference: "high-performance" }));
    gl.setPixelRatio(Math.min(2, devicePixelRatio));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    gl.toneMapping = THREE.ACESFilmicToneMapping;
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(gl, target);
    this.pass = new RenderPass(new THREE.Scene(), this.camera);
    this.composer.addPass(this.pass);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.1, 0.35, 2.5);
    this.composer.addPass(this.bloom);
    this.finish = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, speed: { value: 0 }, hit: { value: 0 }, dim: { value: 0 } },
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }",
      fragmentShader: `uniform sampler2D tDiffuse; uniform float speed, hit, dim; varying vec2 vUv;
        void main(){
          vec2 d = vUv - vec2(0.5, 0.52); float r = length(d);
          float amt = speed * speed * 0.035 * smoothstep(0.25, 0.8, r);
          vec3 c = vec3(0.); for (int i = 0; i < 6; i++) c += texture2D(tDiffuse, vUv - d * amt * float(i) / 5.0).rgb; c /= 6.0;
          c *= 1.0 - 0.28 * smoothstep(0.35, 0.95, r * 1.2);
          c = mix(c, c * vec3(1.6, 0.55, 0.45) + vec3(0.12, 0.0, 0.0), hit * smoothstep(0.15, 0.85, r));
          c *= 1.0 - dim;
          gl_FragColor = vec4(c, 1.);
        }`,
    });
    this.composer.addPass(this.finish);
    this.composer.addPass(new OutputPass());
    addEventListener("resize", () => this.resize());
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.gl.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** speed 0..1 for the edge blur, hit 0..1 for the flash, dim 0..1 to darken behind a card. */
  render(scene: THREE.Scene, fx: { speed?: number; hit?: number; dim?: number } = {}) {
    this.pass.scene = scene;
    const u = this.finish.uniforms;
    u.speed.value = fx.speed ?? 0;
    u.hit.value = fx.hit ?? 0;
    u.dim.value = fx.dim ?? 0;
    this.composer.render();
  }
}
