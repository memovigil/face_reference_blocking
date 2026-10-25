// Valores derivados del estado (pose, puntos clave), memorizados por identidad
// de sus entradas para no recalcular en cada render.

import { buildKeyPoints, estimateExtras, interpupillaryPx, type ExtraEstimate, type ExtraId, type KeyPoint } from '../detect/keypoints';
import { estimatePose, type PoseEstimate } from '../geom/pose';
import type { AppState } from './store';

export interface Derived {
  pose: PoseEstimate;
  extras: Record<ExtraId, ExtraEstimate>;
  keypoints: KeyPoint[];
  /** Distancia entre pupilas, px. */
  ipd: number;
}

let last: {
  landmarks: AppState['landmarks'];
  detection: AppState['detection'];
  adjust: AppState['poseAdjust'];
  placed: AppState['extrasPlaced'];
  value: Derived;
} | null = null;

export function derive(s: AppState): Derived | null {
  if (!s.landmarks || !s.detection) return null;
  if (
    last &&
    last.landmarks === s.landmarks &&
    last.detection === s.detection &&
    last.adjust === s.poseAdjust &&
    last.placed === s.extrasPlaced
  ) {
    return last.value;
  }
  const pose =
    last && last.landmarks === s.landmarks && last.detection === s.detection && last.adjust === s.poseAdjust
      ? last.value.pose
      : estimatePose({
          landmarks: s.landmarks,
          detectedLandmarks: s.detection.landmarks,
          matrix: s.detection.matrix,
          adjust: s.poseAdjust,
        });
  const extras = last && last.value.pose === pose ? last.value.extras : estimateExtras(pose.frame);
  const value: Derived = {
    pose,
    extras,
    keypoints: buildKeyPoints(s.landmarks, extras, s.extrasPlaced),
    ipd: interpupillaryPx(s.landmarks),
  };
  last = { landmarks: s.landmarks, detection: s.detection, adjust: s.poseAdjust, placed: s.extrasPlaced, value };
  return value;
}
