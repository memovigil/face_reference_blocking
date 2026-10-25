// TODO el texto de la interfaz. Español neutro de México, con tuteo.

import type { KeyGroup } from '../detect/keypoints';
import type { LayerId, StepId } from '../state/store';

export const es = {
  appTitle: 'Encaje de Retrato',
  appSubtitle: 'Construcción y parecido a partir de tu foto',

  upload: 'Subir foto',
  uploadHint: 'Arrastra una foto aquí o usa «Subir foto». Todo se procesa en tu computadora: la foto no sale de aquí.',
  emptyTitle: 'Empieza con una foto',
  emptyBody:
    'Sube un retrato: de frente, de ¾ o con la cabeza inclinada. La herramienta detecta la cara, la pose y los rasgos, y construye encima la estructura paso a paso.',
  dropHere: 'Suelta la foto para cargarla',

  status: {
    'empty': 'Sin foto',
    'loading-model': 'Cargando el modelo de detección…',
    'detecting': 'Detectando la cara…',
    'ready': 'Cara detectada',
    'no-face': 'No se encontró una cara',
    'error': 'Algo falló',
  },
  noFaceBody:
    'El detector no encontró una cara en esta foto. Pasa con perfiles muy marcados, dibujos o caras muy tapadas. El modo manual llega en la fase 6; por ahora prueba con otra foto.',
  loadError: 'No se pudo abrir la imagen. Prueba con un JPG o PNG.',
  modelError: 'No se pudo cargar el modelo de detección. Revisa que existan public/models y public/wasm (npm run assets).',

  detection: {
    title: 'Detección',
    face: 'Cara',
    points: (n: number) => `${n} puntos`,
    time: (ms: number) => `${Math.round(ms)} ms`,
    pose: 'Pose',
    expression: 'Expresión',
    light: 'Luz',
    lightPending: 'Se estima en la fase 4',
    neutral: 'Neutra',
    edited: 'Con tus correcciones',
  },

  pose: {
    yaw: 'Giro',
    pitch: 'Cabeceo',
    roll: 'Inclinación',
    yawHint: (d: number) => (Math.abs(d) < 5 ? 'de frente' : d > 0 ? 'mira a la derecha de la foto' : 'mira a la izquierda de la foto'),
    pitchHint: (d: number) => (Math.abs(d) < 5 ? 'nivelada' : d > 0 ? 'mira hacia abajo' : 'mira hacia arriba'),
    rollHint: (d: number) => (Math.abs(d) < 3 ? 'sin inclinar' : d > 0 ? 'inclinada a la derecha de la foto' : 'inclinada a la izquierda de la foto'),
    fine: 'Ajuste fino',
    fineHelp: 'La pose sale de la detección. Usa el ajuste fino solo si la esfera o los anillos no siguen a la cabeza.',
    signOk: 'Signo del giro verificado con la nariz',
    signBad: 'El giro no coincide con la posición de la nariz: revisa los puntos de la nariz y los ojos',
    details: 'Detalles de la detección',
    source: 'La pose sale del ajuste del modelo canónico a la malla detectada (solo posiciones visibles).',
    matrix: 'Matriz de MediaPipe',
    mesh3D: 'Ajuste con la profundidad del detector',
    agreement: (d: number) => `Diferencia con la matriz: ${d.toFixed(1)}° (crece cuando la cara no está centrada en la foto)`,
    fitError: (px: number) => `Error del ajuste: ${px.toFixed(1)} px`,
    engine: (delegate: string, ms: number) => `Detector: ${delegate} · ${Math.round(ms)} ms`,
    reset: 'Volver a lo detectado',
  },

  expressions: {
    jawOpen: 'Boca abierta',
    smile: 'Sonrisa',
    blinkLeft: 'Ojo cerrado (izq. de la foto)',
    blinkRight: 'Ojo cerrado (der. de la foto)',
    blinkBoth: 'Ojos cerrados',
  },

  toolbar: {
    zoomOut: 'Alejar',
    zoomIn: 'Acercar',
    zoom: 'Zoom',
    fit: 'Ajustar',
    hand: 'Mano',
    overlay: 'Superpuesta',
    side: 'Lado a lado',
    lineOpacity: 'Líneas',
    photoOpacity: 'Foto',
    layers: 'Capas',
    reference: 'Referencia',
    construction: 'Construcción',
    theme: 'Tema',
    themes: { auto: 'Automático', light: 'Claro', dark: 'Oscuro' },
  },

  layers: {
    envelope: 'Envolvente',
    structure: 'Estructura',
    measures: 'Medidas',
    points: 'Puntos',
    indices: 'Índices',
  } satisfies Record<LayerId, string>,
  layerKeys: { envelope: '1', structure: '2', measures: '3', points: '4', indices: '5' } satisfies Record<LayerId, string>,

  steps: {
    whatToDo: 'Qué hacer',
    commonError: 'Error común',
    legend: 'Leyenda',
    comingIn: (n: number) => `Llega en la fase ${n}`,
    prev: 'Paso anterior',
    next: 'Paso siguiente',
  },

  review: {
    groups: {
      midline: 'Línea media',
      eyes: 'Ojos',
      brows: 'Cejas',
      nose: 'Nariz',
      mouth: 'Boca',
      contour: 'Contorno',
      skull: 'Cráneo y orejas',
    } satisfies Record<KeyGroup, string>,
    estimated: 'estimado',
    estimatedHelp: 'Los puntos con borde punteado no están en la malla: se estimaron con proporciones promedio. Arrástralos a la silueta real, con cabello.',
    resetDetection: 'Restablecer detección',
    dragHint: 'Arrastra un punto para corregirlo. Haz clic en un nombre para acercarte a él.',
    hidden: 'oculto en esta pose',
  },

  keys: {
    crown: 'Cima del cráneo (con cabello)',
    foreheadTop: 'Frente alta',
    nasion: 'Raíz de la nariz',
    noseTip: 'Punta de la nariz',
    subnasale: 'Base de la nariz',
    upperLip: 'Labio superior',
    lowerLip: 'Labio inferior',
    menton: 'Mentón',
    pupil: 'Pupila',
    eyeOuter: 'Esquina externa del ojo',
    eyeInner: 'Lagrimal',
    browPeak: 'Punto alto de la ceja',
    ala: 'Ala de la nariz',
    mouth: 'Comisura',
    cheek: 'Pómulo, junto a la oreja',
    jaw: 'Ángulo de la mandíbula',
    skull: 'Ancho del cráneo (con cabello)',
    skullBack: 'Contorno trasero del cráneo',
    earTop: 'Punta de la oreja',
    earLobe: 'Lóbulo',
  } as Record<string, string>,
  sidePhoto: { left: 'izq. de la foto', right: 'der. de la foto' },

  legend: {
    point: 'Punto detectado',
    estimated: 'Punto estimado (punteado)',
    selected: 'Punto seleccionado',
    mesh: 'Malla detectada',
    index: 'Número de landmark',
  },

  stepDefs: {
    R: {
      title: 'Revisar puntos',
      what: 'La detección colocó los puntos clave. Acércate con el zoom y revisa que cada uno esté sobre su rasgo; arrastra los que estén corridos. Los puntos punteados (cima, cráneo y orejas) son estimados: llévalos a la silueta real con cabello.',
      error: 'Aceptar los puntos estimados sin revisarlos: la cima y el cráneo con cabello casi nunca coinciden con el promedio.',
      phase: 1,
    },
    A: {
      title: 'Envolvente con rectas',
      what: 'Encierra toda la cabeza, con cabello, en un polígono de 7 a 9 rectas. Mide el ángulo de cada recta contra la plomada y compara los espacios negativos: son lo más fácil de medir a ojo.',
      error: 'Empezar por los ojos. Primero va la silueta general; los rasgos vienen después.',
      phase: 2,
    },
    B: {
      title: 'Esfera de Loomis en 3D',
      what: 'Ubica la esfera del cráneo y su plano lateral. Traza la línea central y los anillos de ceja, nariz y boca siguiendo el giro de la cabeza.',
      error: 'Dibujar la línea central recta cuando la cabeza está girada: se curva sobre la esfera.',
      phase: 2,
    },
    C: {
      title: 'Medidas y triangulación',
      what: 'Compara el triángulo pupila‑pupila‑boca, las plomadas desde lagrimales y alas de la nariz, y los niveles de ceja, nariz, boca y lóbulo. Pasa cada medida a tu hoja y márcala como revisada.',
      error: 'Medir el lado lejano como si la cabeza estuviera de frente: con el giro, ese lado se acorta.',
      phase: 2,
    },
    D: {
      title: 'Blocking de planos',
      what: 'Simplifica la cara en planos grandes que comparten aristas: frente, órbitas, nariz en cuña, pómulos, boca sobre el cilindro de los dientes y mentón. Empieza en el nivel Grande.',
      error: 'Dibujar los rasgos como cajas sueltas: cada plano tiene que tocar a sus vecinos.',
      phase: 3,
    },
    E: {
      title: 'Planos de luz',
      what: 'Rellena cada plano con luz, medio tono o sombra según hacia dónde mira y de dónde viene la luz de la foto.',
      error: 'Inventar la luz: léela de la foto antes de sombrear.',
      phase: 4,
    },
    F: {
      title: 'Sombra en 2 valores',
      what: 'Separa la cabeza en dos masas, luz y sombra. Mueve el terminador hasta que la forma de la sombra se parezca a la de la foto.',
      error: 'Meter medios tonos antes de tener clara la forma de la sombra.',
      phase: 4,
    },
    G: {
      title: 'Medios tonos (3 valores)',
      what: 'Divide la luz en luz y medio tono. Mantén las masas grandes y simples.',
      error: 'Oscurecer el medio tono hasta confundirlo con la sombra.',
      phase: 4,
    },
    H: {
      title: 'Acentos y brillos (5 valores)',
      what: 'Agrega los acentos más oscuros (fosas nasales, comisuras, línea de los párpados) y los brillos más claros, solo donde la foto los tiene.',
      error: 'Repartir acentos por todos lados: pierden fuerza.',
      phase: 4,
    },
    I: {
      title: 'Comparar con la foto',
      what: 'Alterna entre la foto limpia y la construcción. Usa «Lado a lado» para medir con la cruz sincronizada y revisa primero lo que aparece en el resumen.',
      error: 'Corregir detalles antes que la silueta y los tercios.',
      phase: 2,
    },
    J: {
      title: 'Mi dibujo',
      what: 'Sube una foto de tu dibujo. La herramienta lo alinea con la referencia y te dice qué rasgo corregir primero.',
      error: 'Fotografiar el dibujo en ángulo: la perspectiva deforma las medidas.',
      phase: 5,
    },
  } satisfies Record<StepId, { title: string; what: string; error: string; phase: number }>,

  a11y: {
    canvas: 'Foto de referencia con la construcción encima',
    reference: 'Foto de referencia limpia',
    loupe: 'Lupa',
  },
} as const;

export const pct = (x: number) => `${Math.round(x * 100)} %`;
export const degStr = (d: number) => {
  const r = Math.round(d);
  return `${r < 0 ? '−' : ''}${Math.abs(r)}°`;
};
