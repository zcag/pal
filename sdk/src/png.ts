/** Width and height off a PNG's signature and IHDR (the first chunk, bytes 16..24, big-endian); undefined for anything else. */
export function pngSize(head: Uint8Array): { width: number; height: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return;
  if (String.fromCharCode(head[12], head[13], head[14], head[15]) !== "IHDR") return;
  const dv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const width = dv.getUint32(16), height = dv.getUint32(20);
  return width && height ? { width, height } : undefined;
}
