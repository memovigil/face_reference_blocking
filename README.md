# Encaje de Retrato v2

Herramienta local para construir retratos que se parezcan: detecta la cara, sus rasgos y la pose 3D de la cabeza, y construye encima, paso a paso, la estructura de un dibujante (envolvente, Loomis 3D, medidas, blocking de planos y valores).

Todo corre en tu navegador: la foto no sale de tu computadora y el modelo de detección se sirve desde el propio proyecto (sin CDNs).

## Uso

```bash
npm install        # instala y copia el WASM de MediaPipe a public/wasm
npm run dev        # http://localhost:5173
```

Para una versión estática: `npm run build` y luego `npm run preview` (http://localhost:4173).

Requisitos: Node 20 o superior.

## Estado por fases

| Fase | Contenido | Estado |
|---|---|---|
| 1 | Base, detección local, capa de índices, `landmarkMap` verificado, pose, «Revisar puntos», zoom / mano / lado a lado / opacidad | ✅ |
| 2 | Envolvente (A), Loomis 3D (B), medidas (C), marco canónico, diagnóstico, expresiones | — |
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
  state/store.ts, derived.ts estado único y valores derivados (pose, puntos)
  detect/faceLandmarker.ts   carga local del modelo y detección
  detect/landmarkMap.ts      índices nombrados y cómo se verificaron
  detect/keypoints.ts        puntos clave, estimados y arrastre con vecinos
  geom/pose.ts               pose (convenciones y decisión documentadas)
  geom/canonical.ts          modelo canónico y landmarks rígidos
  geom/vec.ts                álgebra mínima
  draw/layers/*.ts           una capa por archivo
  ui/*.ts                    visor, barra, panel
  i18n/es.ts                 todo el texto de la interfaz
  debug/synthRotate.ts       renders girados con verdad conocida (solo pruebas)
tests/
  unit/                      Vitest: pose, mapa de landmarks
  visual/                    Playwright: capturas, pose sintética, interacciones
  fixtures/                  fotos de prueba (ver CREDITS.md)
reference/                   malla canónica oficial de MediaPipe
```

## Pruebas

```bash
npm test             # unitarias (Vitest)
npm run test:visual  # capturas + pose con verdad conocida + interacciones (Playwright)
```

`test:visual` levanta Vite si hace falta y deja las capturas en `tests/screenshots/latest/`. Las capturas revisadas de cada fase se guardan en `tests/screenshots/faseN/`.

La primera vez, Playwright necesita su navegador: `npx playwright install chromium`.
