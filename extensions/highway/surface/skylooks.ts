// How each sky is shown: where its sun sits against the road, exposure, fog, and the light at night.
export type SkyLook = { sunAngle: number; exposure: number; fog: number; fogColor: number; env?: number; night?: boolean };
export const SKY_LOOKS: Record<string, SkyLook> = {
  partly_cloudy: { sunAngle: 2.5, exposure: 1.0, fog: 0.0009, fogColor: 0xb4c2cf },
  clear_midday: { sunAngle: 2.2, exposure: 1.0, fog: 0.0008, fogColor: 0xb9c6d2 },
  golden_hour: { sunAngle: 0.9, exposure: 1.0, fog: 0.0016, fogColor: 0xd8b48e },
  overcast: { sunAngle: 0, exposure: 1.0, fog: 0.0022, fogColor: 0xa9adb0 },
  night: { sunAngle: 2.6, exposure: 0.9, fog: 0.0025, fogColor: 0x0a0d14, env: 0.08, night: true },
};
