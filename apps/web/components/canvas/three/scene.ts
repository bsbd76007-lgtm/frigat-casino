export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  x: number;
  y: number;
  z: number;
}

export interface Scene {
  width: number;
  height: number;
  depthPx: number;
  vanishX: number;
  focus: number;
  scale(y: number): number;
  project(x: number, y: number, z?: number): ScreenPoint;
  shadowOf(x: number, y: number, z: number): { x: number; y: number };
  horizon: number;
}

export interface SceneOptions {
  far?: number;
  near?: number;
  top?: number;
  bottom?: number;
  focus?: number;
  vanish?: number;
  depthStretch?: number;
  light?: WorldPoint;
}

const DEFAULTS: Required<SceneOptions> = {
  far: 2,
  near: 1,
  top: 0.06,
  bottom: 0.98,
  focus: 0.5,
  vanish: 0.5,
  depthStretch: 2.2,
  light: { x: -1.4, y: -0.6, z: 4.5 },
};

export function makeScene(
  width: number,
  height: number,
  options: SceneOptions = {}
): Scene {
  const { far, near, top, bottom, focus, vanish, depthStretch, light } = {
    ...DEFAULTS,
    ...options,
  };

  const distance = (y: number) => far - (far - near) * y;
  const focusDistance = distance(focus);

  const k = ((bottom - top) * height) / (1 / near - 1 / far);
  const horizon = top * height - k / far;
  const vanishX = width * vanish;

  const scale = (y: number) => focusDistance / distance(y);

  const project = (x: number, y: number, z = 0): ScreenPoint => {
    const s = scale(y);
    return {
      x: vanishX + (x - vanishX) * s,
      y: horizon + k / distance(y) - z * s,
    };
  };

  const lightX = light.x * width;
  const lightY = light.y;
  const lightZ = light.z * height;

  const shadowOf = (x: number, y: number, z: number) => {
    if (z <= 0) return { x, y };
    const f = z / (lightZ - z);
    return { x: x + (x - lightX) * f, y: y + (y - lightY) * f };
  };

  return {
    width,
    height,
    depthPx: height * depthStretch,
    vanishX,
    focus,
    horizon,
    scale,
    project,
    shadowOf,
  };
}
