// The renderer: three's WebGL renderer, sized to the page at devicePixelRatio, drawing through the
// finishing chain (looks.ts). Two of three's shader chunks are changed here, before anything compiles:
// the sun's shadows are softer and fade out toward the shadow map's edge, and the sky photo is drawn
// as the light it was made from (un-tone-mapped), so the one tone map at the end treats it like the
// rest of the frame and its sun blooms.
import * as THREE from "./vendor/three.js";
import { Finish, ACES } from "./looks.ts";
import { Reflections, shadowShapes } from "./car.ts";

/** hit 0..1 for the flash, dim 0..1 to darken behind a card; speed is not needed (the motion blur sees it). */
export type Fx = { speed?: number; hit?: number; dim?: number };

// shadows: 12 taps over a disc at least 2.5 texels wide (a soft edge of ~15 cm, not three's 5 taps
// over one texel), and no hard line where the shadow map ends: its last 12% on each side fades out.
// `?fx=-shadows` keeps three's own, for comparing.
{
  const S = THREE.ShaderChunk as unknown as Record<string, string>;
  const k = "shadowmap_pars_fragment", src = S[k];
  const a = src.indexOf("float radius = shadowRadius * texelSize.x;"), b = src.indexOf(") * 0.2;", a);
  if (a > 0 && b > a && !/-shadows/.test(location.search)) S[k] = src.slice(0, a) + `float radius = max(shadowRadius, 2.5) * texelSize.x;
				float phi = interleavedGradientNoise( gl_FragCoord.xy ) * PI2;
				shadow = 0.0;
				for ( int i = 0; i < 12; i ++ ) shadow += texture( shadowMap, vec3( shadowCoord.xy + vogelDiskSample( i, 12, phi ) * radius, shadowCoord.z ) );
				shadow /= 12.0;
				vec2 edge = min( shadowCoord.xy, 1.0 - shadowCoord.xy );
				shadow = mix( 1.0, shadow, smoothstep( 0.0, 0.12, min( edge.x, edge.y ) ) );` + src.slice(b + ") * 0.2;".length);
  // the sky: un-tone-mapped (three's ACES undone), so it comes out of the final tone map as photographed
  const bg = THREE.ShaderLib.backgroundCube;
  bg.fragmentShader = bg.fragmentShader.replace("void main() {", `${ACES}\nvoid main() {`).replace("texColor.rgb *= backgroundIntensity;", "texColor.rgb = unaces( texColor.rgb ) * backgroundIntensity;");
}

export class Renderer {
  gl: THREE.WebGLRenderer;
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
  finish: Finish;
  reflections = new Reflections();

  constructor(canvas: HTMLCanvasElement) {
    const gl = (this.gl = new THREE.WebGLRenderer({ canvas, powerPreference: "high-performance", antialias: false }));
    gl.setPixelRatio(Math.min(2, devicePixelRatio));
    gl.shadowMap.enabled = true;
    gl.shadowMap.type = THREE.PCFShadowMap;
    // the shadow map is drawn once a frame, by the frame's own render (not the reflections'), and the cars
    // cast their merged shapes (car.ts) into it, which only it sees
    gl.shadowMap.autoUpdate = false;
    const shadows = gl.shadowMap.render.bind(gl.shadowMap);
    gl.shadowMap.render = (lights, scene, camera) => { shadowShapes(true); shadows(lights, scene, camera); shadowShapes(false); };
    gl.toneMapping = THREE.ACESFilmicToneMapping; // only the exposure is read (looks.ts tone-maps)
    this.finish = new Finish(gl, this.camera);
    addEventListener("resize", () => this.resize());
    this.resize();
  }

  /** Compile every shader the scene needs, as the frame will draw it, and the finishing's own. */
  async warm(scene: THREE.Scene) {
    this.camera.position.set(0, 2, 0);
    this.camera.lookAt(0, 0, -30);
    this.gl.shadowMap.needsUpdate = true;
    await this.finish.warm(scene);
    await this.reflections.warm(() => this.finish.warm(scene));
    this.finish.render(scene, {});
  }

  /** Send every texture in the scene to the GPU now, so nothing draws late the first time it is seen. */
  upload(scene: THREE.Scene) {
    scene.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      for (const mat of Array.isArray(m) ? m : m ? [m] : []) for (const v of Object.values(mat)) if ((v as THREE.Texture)?.isTexture) this.gl.initTexture(v as THREE.Texture);
    });
  }

  resize(w = innerWidth, h = innerHeight) {
    this.gl.setSize(w, h, false);
    this.finish.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(scene: THREE.Scene, fx: Fx = {}) {
    // the scene's matrices once a frame: the shadow map, the reflections and the frame all draw this one
    scene.updateMatrixWorld();
    scene.matrixWorldAutoUpdate = false;
    this.reflections.update(this.gl, scene, this.camera);
    this.gl.shadowMap.needsUpdate = true;
    this.finish.render(scene, fx);
    scene.matrixWorldAutoUpdate = true;
  }

}
