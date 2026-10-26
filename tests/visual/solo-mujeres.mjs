// Esta versión se centra en rostros femeninos: las mediciones sobre las fotos
// del usuario dejan fuera las de tests/fixtures/user/excluir-canon.json
// (hombres por apariencia y un dibujo dudoso; lista local, no versionada).
// Con TODAS=1 entran todas.
import { readFileSync } from 'node:fs';

let excluded = [];
try {
  excluded = JSON.parse(readFileSync('tests/fixtures/user/excluir-canon.json', 'utf8')).excluir;
} catch {
  // Sin lista: entran todas.
}

/** `file`: ruta o «carpeta/archivo»; la lista guarda «carpeta/prefijo del nombre». */
export const isExcluded = (file) => !process.env.TODAS && excluded.some((e) => file.split('/').slice(-2).join('/').startsWith(e));

export const soloMujeres = (files) => files.filter((f) => !isExcluded(f));
