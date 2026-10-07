import { LAYOUT } from './config';

export const DEPTH_STRETCH = 1.35;

const FAR = 1.3;
const NEAR = 1;
const TOP = 0.04;
const BOTTOM = 1;

const LIGHT = { u: -1.4, t: -0.6, h: 4.5 } as const;

export interface View {
  width: number;
  height: number;
  laneW: number;
  camera: number;
  depthPx: number;
  vanishX: number;
  scale(t: number): number;
  project(u: number, t: number, h?: number): { x: number; y: number };
  laneLeft(lane: number): number;
  shadowOf(u: number, t: number, h: number): { u: number; t: number };
}

export function makeView(
  width: number,
  height: number,
  laneW: number,
  camera: number
): View {
  const distance = (t: number) => FAR - (FAR - NEAR) * t;
  const chickenDistance = distance(LAYOUT.chickenY);

  const k = ((BOTTOM - TOP) * height) / (1 / NEAR - 1 / FAR);
  const horizon = TOP * height - k / FAR;
  const vanishX = width / 2;

  const scale = (t: number) => chickenDistance / distance(t);

  const project = (u: number, t: number, h = 0) => {
    const s = scale(t);
    return { x: vanishX + (u - vanishX) * s, y: horizon + k / distance(t) - h * s };
  };

  const lightU = LIGHT.u * width;
  const lightT = LIGHT.t;
  const lightH = LIGHT.h * height;

  const shadowOf = (u: number, t: number, h: number) => {
    if (h <= 0) return { u, t };
    const f = h / (lightH - h);
    return { u: u + (u - lightU) * f, t: t + (t - lightT) * f };
  };

  return {
    width,
    height,
    laneW,
    camera,
    depthPx: height * DEPTH_STRETCH,
    vanishX,
    scale,
    project,
    laneLeft: (lane: number) => (lane - camera) * laneW,
    shadowOf,
  };
}
