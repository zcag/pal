// Exact Ultra HDR (gain map JPEG) decoder for lighting. Pure JS, no WASM.
//
// three's stock UltraHDRLoader parses these files fine but reconstructs HDR with a display-oriented
// approximation (gain applied in sRGB space, weighted by an assumed display capacity), which comes out
// 10-30% low and shifts colour in the darker sky. This subclass keeps its JPEG/XMP/MPF parsing and only
// replaces the reconstruction with the gain map spec formula at full weight:
//   hdr = (srgbToLinear(sdr) + offsetSdr) * 2^(mix(min, max, gain^(1/gamma))) - offsetHdr
//
//   import { loadSkyHDR } from './sky/decode.js';
//   const tex = await loadSkyHDR('sky/clear_midday.hdr.jpg');   // HalfFloat DataTexture, equirect
//   scene.environment = new THREE.PMREMGenerator(renderer).fromEquirectangular(tex).texture;
import { DataUtils, EquirectangularReflectionMapping, HalfFloatType, LinearSRGBColorSpace } from 'three';
import { UltraHDRLoader } from 'three/addons/loaders/UltraHDRLoader.js';

const SRGB = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });

export class UltraHDRExactLoader extends UltraHDRLoader {
	_applyGainmapToSDR(meta, sdrBuffer, gainBuffer, onSuccess, onError) {
		const decode = (b) => createImageBitmap(new Blob([b], { type: 'image/jpeg' }));
		Promise.all([decode(sdrBuffer), decode(gainBuffer)]).then(([sdr, gain]) => {
			const W = sdr.width, H = sdr.height;
			const ctx = new OffscreenCanvas(W, H).getContext('2d', { willReadFrequently: true });
			ctx.drawImage(gain, 0, 0, gain.width, gain.height, 0, 0, W, H);
			const g = ctx.getImageData(0, 0, W, H).data;
			ctx.drawImage(sdr, 0, 0);
			const s = ctx.getImageData(0, 0, W, H).data;
			// the stock parser stores the XMP offsets multiplied by 64
			const oS = meta.offsetSDR / 64, oH = meta.offsetHDR / 64, lo = meta.gainMapMin, span = meta.gainMapMax - lo;
			const inv = 1 / meta.gamma;
			const boost = new Float32Array(256).map((_, i) => 2 ** (lo + span * (inv === 1 ? i / 255 : (i / 255) ** inv)));
			const half = this.type === HalfFloatType, toHalf = DataUtils.toHalfFloat;
			const out = half ? new Uint16Array(W * H * 4).fill(15360) : new Float32Array(W * H * 4).fill(1);
			for (let i = 0; i < s.length; i += 4) for (let c = 0; c < 3; c++) {
				const v = Math.max((SRGB[s[i + c]] + oS) * boost[g[i + c]] - oH, 0);
				out[i + c] = half ? toHalf(Math.min(v, 65504)) : v; // FloatType keeps the sun above half-float range
			}
			onSuccess(out, W, H);
		}).catch(onError);
	}
}

// type: HalfFloatType (default; values clamp at 65504, which clips the sun core of partly_cloudy/golden_hour)
// or FloatType (keeps the full sun; needs OES_texture_float_linear for filtering)
export async function loadSkyHDR(url, type = HalfFloatType) {
	const tex = await new UltraHDRExactLoader().setDataType(type).loadAsync(url);
	tex.mapping = EquirectangularReflectionMapping;
	tex.colorSpace = LinearSRGBColorSpace;
	return tex;
}
