[English](../en/development.md) | Español

# Desarrollo

Qué encontrará aquí: la estructura del repositorio, cómo probar y ejecutar la extensión en local, la CI, la convención de commits, cómo se publican las versiones, la protección de ramas y cómo agregar documentación.

## Estructura del repositorio

| Ruta | Contenido |
| --- | --- |
| `src/` | La extensión (`index.ts`), el almacén de perfiles, el cambio de credenciales, la detección de cuenta, el comando de inicio de sesión y la lógica del launcher. |
| `bin/` | `gentle-accounts.mjs`, el punto de entrada del launcher. |
| `scripts/` | `next-version.ts` (versión de la release) y el generador de imágenes. |
| `assets/` | El logo y las imágenes de uso (SVG, generadas). |
| `tests/` | Suites de `node:test`, incluidas las pruebas de paridad del README y de la documentación. |
| `docs/` | Esta documentación, en `docs/es/` y `docs/en/`. |
| `odd/` | Notas de la funcionalidad: specs, tareas y un registro de decisiones. |

## Instalar y probar

```sh
pnpm install
pnpm test        # node:test through tsx, runs the real launcher too
pnpm typecheck
```

Las imágenes de `assets/` se generan a partir de los mensajes reales. Regénerelas después de cambiar un mensaje que muestran; un test falla cuando una imagen guardada difiere de una generada de nuevo:

```sh
pnpm run assets
```

## Ejecutar la extensión desde un clon local

Cargue el clon por una sola ejecución con la opción `-e` de pi y una carpeta del agente desechable, para no tocar sus perfiles ni sus inicios de sesión reales:

```sh
PI_CODING_AGENT_DIR="$(mktemp -d)" pi -e .
```

El launcher se puede ejecutar desde el clon de la misma forma:

```sh
PI_CODING_AGENT_DIR="$(mktemp -d)" node bin/gentle-accounts.mjs list
```

Consulte [Instalación](install.md) para instalar el clon con `pi install`.

## CI

`.github/workflows/ci.yml` se ejecuta en cada pull request y en cada push a `main`, en Linux, macOS y Windows con Node 22 y 24 (seis jobs). Cada job ejecuta `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test`, una prueba rápida del launcher (`node bin/gentle-accounts.mjs --help`, con la eliminación de tipos de Node y sin tsx) y `npm pack --dry-run`.

`.github/workflows/pr-title.yml` comprueba que el título del pull request sea un Conventional Commit.

## Conventional Commits y versiones

`main` solo acepta pull requests fusionados con squash, así que el título del PR pasa a ser el mensaje del commit y decide el aumento de versión. Use un título [Conventional Commits](https://www.conventionalcommits.org/) (`feat: ...`, `fix: ...`, `docs: ...`). Los tipos van en minúsculas; `Feat:` no es convencional y cuenta como patch.

| Commit | `0.x` | Desde `1.0.0` |
| --- | --- | --- |
| `feat: ...` | minor | minor |
| `fix: ...` y cualquier otro | patch | patch |
| `feat!: ...`, `fix!: ...` o un pie `BREAKING CHANGE:` | minor | major |

## Tag y Release en cada merge

Cada merge a `main` ejecuta `.github/workflows/release.yml`, que crea un tag `vX.Y.Z` y una GitHub Release con notas generadas. No hay PR de release: el workflow usa el `GITHUB_TOKEN` predeterminado con `contents: write` para el tag y la release, y publica la versión etiquetada en npm con el secret de repositorio `NPM_TOKEN`.

- Las releases se ejecutan de a una y nunca se cancelan a mitad de camino.
- El checkout usa el historial completo y los tags. `scripts/next-version.ts` rechaza un clon superficial con `next-version: shallow clone detected; fetch the full history and tags (checkout with fetch-depth: 0)`, porque sin los tags daría `0.1.0` en silencio.
- Un commit que ya tiene tag se omite, así que volver a ejecutar el workflow es seguro.
- La siguiente versión sale del último tag `vX.Y.Z` alcanzable y del mensaje del commit fusionado; el texto del commit nunca se inserta en un script de shell. Sin ningún tag, la primera release es `0.1.0`.
- La release se crea con `gh release create` y `--generate-notes`.
- El paso de publicación en npm pone la versión del tag en `package.json` solo dentro del runner (no se commitea nada), se omite con una advertencia si falta `NPM_TOKEN`, y no hace nada si esa versión ya está en npm. `NPM_TOKEN` es un token granular de npm con permiso de escritura sobre el paquete y bypass de 2FA.

Para ver la versión que obtendría la próxima release:

```sh
node scripts/next-version.ts
```

El cuerpo del PR también cuenta: una línea que empieza con `BREAKING CHANGE:` aumenta la versión, aunque solo se esté citando.

El campo `version` de `package.json` no se reescribe en `main` (los push directos están bloqueados); el tag es la fuente de verdad y el paquete de npm recibe esa versión al publicarse.

## Protección de ramas

`main` está protegida:

- Los cambios entran mediante un pull request.
- Seis checks obligatorios: los jobs de CI `ubuntu-latest / node 22`, `ubuntu-latest / node 24`, `macos-latest / node 22`, `macos-latest / node 24`, `windows-latest / node 22` y `windows-latest / node 24`.
- Historial lineal; solo se permiten merges con squash.
- Un ruleset llamado `main: only repository admins can update` restringe las actualizaciones a los administradores del repositorio, así que el merge necesita el bypass de administrador, por ejemplo:

```sh
gh pr merge --squash --admin
```

## Imagen de vista previa social

`assets/social-preview.png` (1280x640) es la imagen que GitHub muestra cuando se comparte el repositorio. Se genera a partir de `assets/social-preview.svg`, que produce `pnpm run assets`. Genere el PNG con Chrome sin interfaz y un `--user-data-dir` nuevo y vacío:

```sh
chrome --headless=new --user-data-dir="$(mktemp -d)" --window-size=1280,640 --default-background-color=1a1218ff --screenshot=assets/social-preview.png "file://$PWD/assets/social-preview.svg"
```

`chrome` representa su binario de Chrome o Chromium. GitHub no tiene una API para esta imagen, así que se sube a mano: Settings del repositorio > General > Social preview > Edit > Upload an image (PNG, JPG o GIF, de menos de 1 MB).

## La carpeta `odd/`

`odd/` guarda el documento de la funcionalidad con el que se construyó este paquete: specs numeradas (`S#`), la lista de tareas (`T#`) y un registro de decisiones del usuario y evidencia (`L#`). Explica por qué las cosas son como son; léalo antes de cambiar un comportamiento.

## Agregar un documento

La documentación vive en dos carpetas con los mismos nombres de archivo: `docs/es/` (español) y `docs/en/` (inglés). Para agregar una página:

1. Cree el archivo en ambas carpetas con el mismo nombre.
2. Empiece cada archivo con la línea de cambio de idioma que apunta al archivo del otro idioma.
3. Mantenga idénticos los bloques de código, el código en línea, las URL, los destinos de enlaces e imágenes y la cantidad de títulos; solo se traducen la prosa, los títulos y el texto de las tablas.
4. Agréguelo a la tabla de ambos `README.md` de `docs/`.
5. Agregue el nombre del archivo a `FILES` en `tests/docs-parity.test.ts` y ejecute `pnpm test`.
