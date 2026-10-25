// Valores derivados del estado, por etapas memorizadas por identidad de sus
// entradas: arrastrar un punto recalcula solo lo que depende de él.
//
//   pose ─┬─ puntos estimados ─ puntos clave
//         ├─ marco de frente ─ mentón cerrado ─┬─ Loomis ─ métricas
//         │                                    └──────────┘
//   segmentación ─ silueta ─ envolvente

import { buildKeyPoints, EAR_LOBE, EAR_TOP, earAnchors, estimateExtras, interpupillaryPx, type ExtraEstimate, type ExtraId, type KeyPoint } from '../detect/keypoints';
import { FACE_OVAL } from '../detect/landmarkMap';
import { circumscribe, edgeAngles, negativeSpaces, plumbLine, type Envelope } from '../geom/envelope';
import { closeJaw, MANDIBLE, readExpression, type ExpressionReading, type JawClosing } from '../geom/expression';
import { rayToFrontal, toFrontal, type FrontalFace } from '../geom/frontal';
import { buildLoomis, type Loomis } from '../geom/loomis';
import { computeMetrics, nearSide, type MetricValue } from '../geom/metrics';
import { estimatePose, fitSimilarity2D, projectCanonical, type PoseEstimate } from '../geom/pose';
import { convexHull, headSilhouette, type HeadSilhouette } from '../geom/silhouette';
import { v2, type Vec2, type Vec3 } from '../geom/vec';
import type { AppState } from './store';

export interface Derived {
  pose: PoseEstimate;
  extras: Record<ExtraId, ExtraEstimate>;
  keypoints: KeyPoint[];
  /** Distancia entre pupilas, px. */
  ipd: number;
  silhouette: HeadSilhouette | null;
  expression: ExpressionReading;
  /** Marco de frente tal como se ve. */
  frontal: FrontalFace;
  jaw: JawClosing | null;
  /** Marco de frente para medir (mandíbula cerrada si hace falta). */
  frontalMeasure: FrontalFace;
  /** Landmarks en px con la mandíbula cerrada (null si la boca no se cerró). */
  closedLandmarks: Vec3[] | null;
  loomis: Loomis;
  metrics: MetricValue[];
  envelope: Envelope;
}

/** Memoriza el último resultado de `fn` mientras sus entradas sean las mismas (===). */
function memo<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let lastArgs: A | null = null;
  let last: R;
  return (...args: A) => {
    if (lastArgs && args.length === lastArgs.length && args.every((a, i) => a === lastArgs![i])) return last;
    lastArgs = args;
    last = fn(...args);
    return last;
  };
}

const anchorKey = (a: { image: { x: number; y: number } }[]) => a.map((x) => `${x.image.x},${x.image.y}`).join('|');

// Las anclas se recalculan desde extrasPlaced pero solo cambian si se movió una oreja.
let lastAnchorsKey = '';
let lastAnchors: ReturnType<typeof earAnchors> = [];
function anchorsFor(placed: AppState['extrasPlaced']) {
  const a = earAnchors(placed);
  const k = anchorKey(a);
  if (k !== lastAnchorsKey) {
    lastAnchorsKey = k;
    lastAnchors = a;
  }
  return lastAnchors;
}

const poseStage = memo((landmarks: Vec3[], detection: NonNullable<AppState['detection']>, adjust: AppState['poseAdjust'], anchors: ReturnType<typeof earAnchors>) =>
  estimatePose({ landmarks, detectedLandmarks: detection.landmarks, matrix: detection.matrix, adjust, anchors }),
);

// La silueta usa la detección original (no las correcciones): no cambia al arrastrar puntos.
const silhouetteStage = memo((seg: AppState['segmentation'], detection: NonNullable<AppState['detection']>) =>
  seg ? headSilhouette(seg, detection.landmarks, fitSimilarity2D(detection.landmarks)) : null,
);

const extrasStage = memo((pose: PoseEstimate, sil: HeadSilhouette | null) => estimateExtras(pose.frame, sil));

const keypointsStage = memo((landmarks: Vec3[], extras: Record<ExtraId, ExtraEstimate>, placed: AppState['extrasPlaced']) =>
  buildKeyPoints(landmarks, extras, placed),
);

const expressionStage = memo((detection: NonNullable<AppState['detection']>, ignore: AppState['ignoreExpressions']) =>
  readExpression(detection.blendshapes, ignore),
);

const frontalStage = memo((landmarks: Vec3[], pose: PoseEstimate) => toFrontal(landmarks, pose.frame, 'detector3d'));

const jawStage = memo((frontal: FrontalFace, expression: ExpressionReading, landmarks: Vec3[], pose: PoseEstimate) => {
  // Se cierra solo si la abertura es de mandíbula (no labios en «O»).
  const jaw = expression.flags.jawOpen && !expression.flags.lipsO ? closeJaw(frontal.points, frontal.unit) : null;
  if (!jaw) return { jaw: null, measure: frontal, closed: null };
  const measure: FrontalFace = { ...frontal, points: jaw.points };
  const closed = landmarks.slice();
  for (const i of MANDIBLE) closed[i] = projectCanonical(pose.frame, jaw.points[i]);
  return { jaw, measure, closed };
});

function keyPoint(kps: KeyPoint[], id: string): KeyPoint | undefined {
  return kps.find((k) => k.def.id === id);
}

const loomisStage = memo((pose: PoseEstimate, landmarks: Vec3[], measure: FrontalFace, frontal: FrontalFace, kps: KeyPoint[], closed: Vec3[] | null) => {
  // Silueta del cráneo para la esfera: solo la cima (§6 B: frente alta, sienes y
  // cima con cabello). El ancho con cabello de los lados va a la envolvente: un
  // cabello voluminoso inflaría la esfera. Sin puntos recortados por el borde.
  const sil = ['crown']
    .map((id) => keyPoint(kps, id))
    .filter((k): k is KeyPoint => !!k && k.visible && k.caveat !== 'cropped')
    .map((k) => ({ p: k.p, weight: 1 }));
  const hair = keyPoint(kps, 'hairline');
  const ears = (['R', 'L'] as const)
    .map((side) => {
      const top = keyPoint(kps, `earTop${side}`);
      const lobe = keyPoint(kps, `earLobe${side}`);
      return top && lobe && top.visible && lobe.visible ? { side, top: top.p, lobe: lobe.p } : null;
    })
    .filter((e): e is { side: 'R' | 'L'; top: Vec2; lobe: Vec2 } => !!e);
  return buildLoomis({
    frame: pose.frame,
    landmarks,
    face: measure,
    faceAsSeen: frontal,
    silhouette: sil,
    hairline: hair && (!hair.estimated || hair.source === 'silhouette') ? hair.p : null,
    ears,
    closedLandmarks: closed ?? undefined,
    yaw: pose.angles.yaw,
  });
});

const metricsStage = memo((pose: PoseEstimate, measure: FrontalFace, frontal: FrontalFace, expression: ExpressionReading, loomis: Loomis, kps: KeyPoint[], jawClosed: boolean) => {
  const hair = keyPoint(kps, 'hairline');
  const crown = keyPoint(kps, 'crown');
  const side = nearSide(pose.angles.yaw);
  const earSide = side === 'both' ? 'L' : side;
  const top = keyPoint(kps, `earTop${earSide}`);
  const lobe = keyPoint(kps, `earLobe${earSide}`);
  const ears =
    top?.visible && lobe?.visible
      ? {
          top: rayToFrontal(pose.frame, top.p, EAR_TOP.z)?.y,
          lobe: rayToFrontal(pose.frame, lobe.p, EAR_LOBE.z)?.y,
          confirmed: !top.estimated && !lobe.estimated,
        }
      : undefined;
  const measured = (k?: KeyPoint) => !!k && (!k.estimated || (k.source === 'silhouette' && !k.caveat));
  const frontalView = Math.abs(pose.angles.yaw) < 20;
  return computeMetrics({
    face: measure,
    depthFace: frontal,
    yaw: pose.angles.yaw,
    expression: expression.flags,
    jawClosed,
    hairline: { y: loomis.levels.hairline, confirmed: measured(hair) },
    head: { top: loomis.headTop, width: loomis.headWidth, confirmed: measured(crown), widthConfirmed: measured(crown) && frontalView },
    ears,
  });
});

const envelopeStage = memo((sil: HeadSilhouette | null, seg: AppState['segmentation'], landmarks: Vec3[], kps: KeyPoint[], sides: number): Envelope => {
  let hull: Vec2[];
  let source: Envelope['source'];
  if (sil) {
    hull = sil.hull;
    source = 'silhouette';
  } else {
    const pts = FACE_OVAL.map((i) => v2(landmarks[i].x, landmarks[i].y));
    for (const id of ['crown', 'skullR', 'skullL', 'skullBack', 'earTopR', 'earTopL', 'earLobeR', 'earLobeL']) {
      const k = keyPoint(kps, id);
      if (k?.visible) pts.push(k.p);
    }
    hull = convexHull(pts);
    source = 'points';
  }
  const polygon = circumscribe(hull, sides);
  const crown = keyPoint(kps, 'crown')!.p;
  return {
    polygon,
    edges: edgeAngles(polygon),
    plumb: plumbLine(polygon, crown),
    negative: seg && sil ? negativeSpaces(seg, polygon) : [],
    source,
  };
});

export function derive(s: AppState): Derived | null {
  if (!s.landmarks || !s.detection) return null;
  const pose = poseStage(s.landmarks, s.detection, s.poseAdjust, anchorsFor(s.extrasPlaced));
  const silhouette = silhouetteStage(s.segmentation, s.detection);
  const extras = extrasStage(pose, silhouette);
  const keypoints = keypointsStage(s.landmarks, extras, s.extrasPlaced);
  const expression = expressionStage(s.detection, s.ignoreExpressions);
  const frontal = frontalStage(s.landmarks, pose);
  const { jaw, measure, closed } = jawStage(frontal, expression, s.landmarks, pose);
  const loomis = loomisStage(pose, s.landmarks, measure, frontal, keypoints, closed);
  const metrics = metricsStage(pose, measure, frontal, expression, loomis, keypoints, !!jaw);
  const envelope = envelopeStage(silhouette, s.segmentation, s.landmarks, keypoints, s.envelopeSides);
  return {
    pose,
    extras,
    keypoints,
    ipd: interpupillaryPx(s.landmarks),
    silhouette,
    expression,
    frontal,
    jaw,
    frontalMeasure: measure,
    closedLandmarks: closed,
    loomis,
    metrics,
    envelope,
  };
}
