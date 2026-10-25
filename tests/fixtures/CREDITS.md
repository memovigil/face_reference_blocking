# Créditos de las fotos de prueba

## tests/fixtures/mediapipe/

Imágenes de prueba públicas del proyecto MediaPipe de Google, bajo licencia Apache 2.0.
Origen: `https://storage.googleapis.com/mediapipe-assets/` (se bajan con `npm run fixtures`).

| Archivo | Uso en las pruebas |
|---|---|
| `face_stylizer_raw_face_demo.png` | frontal, sonrisa con dientes, base de la pose sintética |
| `portrait.jpg` | frontal, cara arriba del centro (sesgo de la matriz) |
| `portrait_rotated.jpg` | la misma foto girada 90° (inclinación extrema) |
| `portrait_small.jpg` | baja resolución (256 px) |
| `business-person.png` | ligero giro, cabello voluminoso, cara pequeña en la foto |
| `man-woman-okay.jpg` | contrapicado, cara a la izquierda del centro |
| `face_stylizer_style_color_sketch.jpg` | dibujo a lápiz de color |

## tests/fixtures/user/

Fotos del usuario. No se versionan (ver `.gitignore`); ver `user/README.md`.

## reference/

`canonical_face_model.obj` y `canonical_face_model_uv_visualization.png`: modelo canónico oficial de MediaPipe (Apache 2.0), de `google-ai-edge/mediapipe/mediapipe/modules/face_geometry/data/`.
