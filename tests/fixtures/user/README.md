# Fotos de prueba del usuario

Fotos limpias, sin líneas encima. No se suben a git (son personales).

**No hace falta renombrarlas.** Ponlas en una subcarpeta (por ejemplo `referencias/`)
y la detección las clasifica sola en los casos del plan de pruebas (§12.1):

```bash
npm run test:refs      # o npm run test:visual, que corre todo
```

Deja en `tests/screenshots/latest/referencias/` una captura por foto y
`resumen.json` con la pose, la verificación del signo, las expresiones y los casos:
frontal, tres-cuartos-izq, tres-cuartos-der, tres-cuartos-fuerte, inclinada,
mira-arriba, mira-abajo, sonrisa, boca-abierta, ojos-cerrados, labios-fruncidos,
baja-resolucion y sin-cara (perfiles puros: modo manual, fase 6).

Casos que conviene agregar si los tienes: barba, lentes y un dibujo a lápiz realista.
Varias fotos de la misma persona en ángulos distintos sirven para probar que las
proporciones no cambian con el giro (fase 2).
