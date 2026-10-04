import type { DataTexture, TextureDataType } from "three";
/** An Ultra HDR (gain-map) JPEG as an equirectangular HDR texture. */
export function loadSkyHDR(url: string, type?: TextureDataType): Promise<DataTexture>;
