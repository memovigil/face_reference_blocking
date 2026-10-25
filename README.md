# Encaje de Retrato v2

Herramienta local para construir retratos que se parezcan: detecta la cara, sus rasgos y la pose 3D de la cabeza, y construye encima, paso a paso, la estructura de un dibujante (envolvente, Loomis 3D, medidas, blocking de planos y valores).

Todo corre en tu navegador: la foto no sale de tu computadora y el modelo de detección se sirve desde el propio proyecto (sin CDNs).

## Uso

```bash
npm install        # instala, copia el WASM de MediaPipe a public/wasm y baja el modelo de segmentación
npm run dev        # http://localhost:5173
```

¿Sin foto a la mano? «Probar con la muestra» genera en la propia app una cabeza 3D con luz clave (no es la foto de una persona).

Para una versión estática: `npm run build` y luego `npm run preview` (http://localhost:4173).

Requisitos: Node 20 o superior.

## Estado por fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Base, detección local, capa de índices, `landmarkMap` verificado, pose, «Revisar puntos», zoom / mano / lado a lado / opacidad | ✅ |
| 2 | Envolvente (A), Loomis 3D (B), medidas (C), marco canónico, diagnóstico, expresiones, silueta con cabello, muestra 3D | ✅ |
| 3 | Blocking de planos (D) | — |
| 4 | Luz y valores (E–H) | — |
| 5 | Mi dibujo (J) | — |
| 6 | Modo manual y perfil | — |
| 7 | Exportar, persistencia, móvil, accesibilidad, pulido | — |

## Atajos

| Tecla | Acción |
|---|---|
| ← → | Paso anterior / siguiente |
| 1–5 | Capas: Envolvente, Estructura, Medidas, Puntos, Índices |
| H | Mano |
| Espacio + arrastrar | Mano temporal |
| F | Ajustar |
| + / − | Acercar / alejar |
| Ctrl + rueda | Zoom al cursor (en trackpad: pellizcar) |
| Esc | Quitar selección |

## Estructura

```
src/
  main.ts                    arranque y conexión de módulos
  state/store.ts, derived.ts estado único y valores derivados (por etapas, memorizados)
  detect/faceLandmarker.ts   carga local del modelo y detección
  detect/segment.ts          segmentación cabello / cara / fondo (local)
  detect/landmarkMap.ts      índices nombrados y cómo se verificaron
  detect/keypoints.ts        puntos clave, estimados y arrastre con vecinos
  geom/pose.ts               pose (convenciones y decisión documentadas)
  geom/canonical.ts          modelo canónico y landmarks rígidos
  geom/frontal.ts            marco «de frente» para medir (método elegido por invariancia)
  geom/metrics.ts            diagnóstico y canon (fuente y n de cada valor)
  geom/expression.ts         expresiones por blendshapes y mentón cerrado
  geom/silhouette.ts         silueta de la cabeza con cabello
  geom/envelope.ts           paso A: envolvente, plomada, espacios negativos
  geom/loomis.ts             paso B: esfera ajustada, plano lateral, anillos sobre la malla
  geom/measures.ts           paso C: plomadas, niveles, triángulo, ángulos
  geom/vec.ts                álgebra mínima
  sample/render.ts           muestra de ejemplo: cabeza 3D rasterizada en la app
  draw/layers/*.ts           una capa por archivo
  ui/*.ts                    visor, barra, panel
  i18n/es.ts                 todo el texto de la interfaz
  debug/synthRotate.ts       renders girados con verdad conocida (solo pruebas)
tests/
  unit/                      Vitest: pose, mapa de landmarks, métricas, expresiones, envolvente, Loomis, medidas
  visual/                    Playwright: capturas, pose sintética, interacciones, pasos, muestra, invariancia
  fixtures/                  fotos de prueba (ver CREDITS.md)
reference/                   malla canónica oficial de MediaPipe
```

## Pruebas

```bash
npm test             # unitarias (Vitest)
npm run test:visual  # capturas + pose con verdad conocida + interacciones (Playwright)
```

Otras herramientas de revisión:

```bash
node tests/visual/steps.mjs <salida> <foto>… --steps=A,B,C   # captura cada paso
node tests/visual/sample.mjs <salida>                        # muestra 3D: pose detectada contra la renderizada
node tests/visual/invariance.mjs                             # mismas personas en varias poses (fotos propias)
```

`test:visual` levanta Vite si hace falta y deja las capturas en `tests/screenshots/latest/`. Las capturas revisadas de cada fase se guardan en `tests/screenshots/faseN/`.

La primera vez, Playwright necesita su navegador: `npx playwright install chromium`.

## Decisiones de la fase 2

- **Medir sin el giro.** Las métricas se calculan en un marco «de frente» (`geom/frontal.ts`). Se probaron dos métodos con 14 grupos de la misma persona en distintas poses; el elegido se desvía en promedio 2.4–3.8 % dentro de cada grupo (`tests/screenshots/fase2/invariancia.json`).
- **El canon es un promedio, no un ideal.** Cada valor dice de dónde sale: medianas medidas con el mismo detector en un conjunto de referencias (una foto por persona, `canon-poblacion.json`), Loomis para las orejas y tercios iguales solo como convención de dibujo (`geom/metrics.ts`).
- **Expresiones.** Sonrisa, boca abierta, ojos cerrados y boca en «O» salen de los blendshapes; cada una puede ignorarse. Con la boca abierta se cierra la mandíbula girándola alrededor de la bisagra y la real se dibuja en rojo punteado.
- **Silueta con cabello.** La segmentación local estima cima, cráneo y nacimiento del cabello; si la foto los corta o el fleco los tapa, el punto queda como estimado y no entra en el diagnóstico.
- **Fotos del usuario.** Nunca se versionan (`tests/fixtures/user/` está en `.gitignore`); en el repositorio solo quedan resúmenes numéricos y capturas de la muestra 3D y de las fotos de prueba de MediaPipe.
