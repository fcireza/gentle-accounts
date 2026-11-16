Español | [English](README.en.md)

> Los mensajes del programa se muestran en inglés.

# gentle-accounts

> **Antes se llamaba gentle-profiles.** El comando `/profile` ahora es `/gentle:accounts` (con los mismos subcomandos), el lanzador es `gentle-accounts` y el repositorio de GitHub cambió de nombre a `fcireza/gentle-accounts` (las URL anteriores redirigen). Tus perfiles en disco no cambian.

Usa **más de una cuenta** en [Gentle Shell](https://gentlemanprogramming.com/gentle-hub/) (y en pi): un Claude de `work` y un Claude `personal`, dos sesiones de Codex, etc. Cambia entre ellas con un solo comando y ve siempre qué cuenta está activa.

Funciona en Linux, macOS y Windows.

```
status bar:   gentle-accounts: work · you****@company.com
```

## Qué hace

Gentle Shell se comunica con Claude a través de [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge), que usa la sesión iniciada en la CLI `claude`. Esa sesión vive en una sola carpeta, así que normalmente tienes una sola cuenta. Este paquete le da a cada **perfil** su propia carpeta y sus propias credenciales, y las intercambia cuando cambias de perfil:

| Proveedor | Qué guarda cada perfil |
| --- | --- |
| Claude (mediante claude-bridge) | su propia sesión de Claude Code (un `CLAUDE_CONFIG_DIR` separado) |
| Codex (`openai-codex`) | sus propias credenciales en el `auth.json` de pi |
| Anthropic (proveedor nativo de pi) | sus propias credenciales en el `auth.json` de pi |

Cualquier otro proveedor que tengas en pi queda intacto.

## Instalación

### En Gentle Shell

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

Todo lo que va después de `--` se pasa a pi, que clona el paquete en el home de Gentle Shell (`~/.gentle-shell/agent`) y lo agrega al `settings.json` de ese home. Reinicia Gentle Shell y `/gentle:accounts` estará disponible. Las opciones de Gentle Shell, como `--home <path>`, van antes del `--`.

Si instalaste el paquete anterior (`git:github.com/fcireza/gentle-profiles`), primero elimina esa línea de la lista `packages` en `~/.gentle-shell/agent/settings.json`. Con ambos instalados, el antiguo `/profile` y el nuevo `/gentle:accounts` funcionarían al mismo tiempo.

### En pi sin Gentle Shell

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Requisitos: pi 1.5.1 o superior, la CLI `claude` y pi-claude-bridge para los perfiles de Claude, y Node 22.18 o superior para el lanzador.

### El lanzador `gentle-accounts` (opcional)

La extensión ya ofrece `/gentle:accounts` dentro de Gentle Shell. El lanzador sirve para iniciar una sesión directamente en un perfil. Instalar el paquete desde git no lo agrega a tu `PATH`, así que llámalo por su ruta o crea un alias:

```sh
# bash / zsh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

```powershell
# perfil de PowerShell
function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }
```

## Actualizar y desinstalar

Reinstalar descarga la versión más reciente de `main`. Para desinstalarlo, elimina la línea `git:github.com/fcireza/gentle-accounts` de la lista `packages` en `~/.gentle-shell/agent/settings.json`. Tus perfiles permanecen en disco dentro de `profiles/` hasta que borres esa carpeta.

## Inicio rápido

La primera vez que se carga, tus sesiones actuales se agrupan en un perfil llamado `default`. No se mueve ni se copia nada: `default` sigue usando la carpeta predeterminada de Claude Code con `CLAUDE_CONFIG_DIR` **sin definir** (definirla como `~/.claude` haría que Claude Code perdiera la sesión en macOS, donde la entrada del llavero depende de esa variable). Si ya habías definido `CLAUDE_CONFIG_DIR`, esa carpeta se registra y se conserva.

1. Crea un segundo perfil y cámbiate a él, dentro de Gentle Shell:
   ```
   /gentle:accounts create work
   /gentle:accounts work
   ```
2. Inicia sesión en Claude con ese perfil. Esto muestra un comando; ejecútalo en **otra terminal**:
   ```
   /gentle:accounts login claude
   ```
3. Inicia sesión en Codex o Anthropic con el `/login` habitual de pi, si los usas.
4. Cambia de un perfil a otro cuando quieras:
   ```
   /gentle:accounts default
   /gentle:accounts work
   ```

La barra de estado muestra `gentle-accounts: <profile> · <masked email>` (por ejemplo `gentle-accounts: work · fcir****@gmail.com`), o `gentle-accounts: <profile> · not logged in` (sin sesión iniciada).

## Comandos

### Dentro de Gentle Shell: `/gentle:accounts`

| Comando | Qué hace |
| --- | --- |
| `/gentle:accounts` | Abre un selector con tus perfiles y cambia al que elijas. |
| `/gentle:accounts <name>` | Cambia a `<name>`. Si ya está activo, muestra: `Already on profile "<name>".` |
| `/gentle:accounts list` | Lista los perfiles. `*` marca el activo. |
| `/gentle:accounts current` | Muestra el perfil activo y su carpeta de Claude (`Active profile: work (CLAUDE_CONFIG_DIR=...)`; para `default`: `CLAUDE_CONFIG_DIR=(unset: Claude Code default)`) y actualiza la barra de estado. |
| `/gentle:accounts create <name>` | Crea un perfil vacío. |
| `/gentle:accounts delete <name>` | Elimina un perfil después de pedir confirmación. No se puede eliminar el perfil activo. |
| `/gentle:accounts login claude` | Muestra el comando que inicia sesión en Claude Code con el perfil activo (simplemente `claude auth login` para `default`). |
| `/gentle:accounts help` | Muestra la lista de comandos. |

Los nombres de perfil usan letras minúsculas, dígitos, `-` o `_` (hasta 32 caracteres). El cambio de perfil espera hasta que el agente esté inactivo.

### Desde la terminal: `gentle-accounts`

| Comando | Qué hace |
| --- | --- |
| `gentle-accounts <name> [args...]` | Inicia `gentle-shell` con ese perfil. Los argumentos adicionales se pasan a `gentle-shell`. |
| `gentle-accounts list` | Lista los perfiles. `*` marca el activo. |
| `gentle-accounts current` | Muestra el perfil activo. |
| `gentle-accounts create <name>` | Crea un perfil vacío. |
| `gentle-accounts login <name>` | Ejecuta `claude auth login` para la carpeta de Claude de ese perfil (sin `CLAUDE_CONFIG_DIR` para `default`). |
| `gentle-accounts --help` | Muestra la lista de comandos. |

Ejemplos:

```sh
gentle-accounts work                  # open Gentle Shell as "work"
gentle-accounts personal --isolated   # extra args are passed through
gentle-accounts login work            # log "work" into Claude
```

Si un perfil no existe, el lanzador lo indica y termina con código 1:
`Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`.

## Cómo funciona el cambio de perfil

Al cambiar a un perfil:

1. guarda tus credenciales actuales de Codex y Anthropic en el perfil que dejas,
2. carga en pi las credenciales del nuevo perfil,
3. apunta `CLAUDE_CONFIG_DIR` a la carpeta de Claude del nuevo perfil, para que la siguiente solicitud a Claude use esa sesión (para `default` la variable se elimina, y el lanzador inicia `gentle-shell` sin ella),
4. recuerda el perfil como activo y actualiza la barra de estado.

Si algún archivo de credenciales no se puede leer, el cambio se detiene con un error y no modifica nada.

## Dónde se guardan los datos

Dentro de la carpeta del agente de pi (`~/.gentle-shell/agent` para Gentle Shell, `~/.pi/agent` para pi sin Gentle Shell):

```
profiles/
  current             the active profile name
  work/
    claude/           this profile's Claude Code login
    auth.json         this profile's Codex / Anthropic credentials
  default/
    claude-default    marker: use Claude Code's default folder, CLAUDE_CONFIG_DIR unset
    auth.json
```

Si habías definido `CLAUDE_CONFIG_DIR` cuando se creó `default`, este contiene un archivo `claude-dir` con esa ruta en lugar del marcador. Un `default` antiguo cuyo `claude-dir` apunta a `~/.claude` se trata igual que el marcador.

El lanzador encuentra esa carpeta a partir de `PI_CODING_AGENT_DIR`, luego `GENTLE_SHELL_HOME` y luego `~/.gentle-shell/agent`.

## Conviene saber

- **Barra de estado.** La sesión se detecta ejecutando `claude auth status` para el perfil activo (tiempo límite de 5 s). Si la CLI `claude` no está instalada, excede el tiempo límite o no devuelve JSON, el correo se lee del `.claude.json` de Claude Code. El correo siempre aparece enmascarado: los primeros `min(4, max(1, length - 3))` caracteres del nombre, luego `****` y luego el dominio; la dirección completa nunca se muestra. Se actualiza al iniciar, al cambiar de perfil, con `/gentle:accounts current`, después de cada turno del agente y cada 60 segundos, así que un inicio de sesión hecho desde otra terminal aparece automáticamente. Codex no muestra correo, porque pi solo guarda un identificador de cuenta opaco.
- **Menú.** El menú de comandos de Gentle Shell es una lista fija que las extensiones no pueden ampliar, así que los puntos de entrada son `/gentle:accounts` y la barra de estado.
- **Los tokens OAuth rotan.** Si usas la misma sesión de Codex o Anthropic en otra herramienta al mismo tiempo, una copia guardada puede quedar desactualizada. Vuelve a iniciar sesión desde ese perfil.
- **Windows.** El lanzador inicia `gentle-shell` a través del shell para que se resuelvan los shims `.cmd`.
- **No cambies de perfil a mitad de un turno.** El comando se niega mientras el agente está trabajando.

## Desarrollo

```sh
pnpm install
pnpm test        # node:test through tsx, runs the real launcher too
pnpm typecheck
```

La CI ejecuta las pruebas en Linux, macOS y Windows con Node 22 y 24.

## Versiones

Las versiones se publican automáticamente y siguen [Conventional Commits](https://www.conventionalcommits.org/). `main` solo acepta Pull Requests fusionados con squash, así que el título del PR se convierte en el mensaje del commit: usa un título convencional (`feat: ...`, `fix: ...`, `docs: ...`). Una verificación lo exige.

1. Fusiona tus PR en `main`.
2. Un bot mantiene abierto un **PR de versión** ("chore(main): release x.y.z") con la nueva versión y el changelog.
3. Al fusionar ese PR se crean la etiqueta `vx.y.z` y el GitHub Release con sus notas.

La primera versión es `0.1.0`. Mientras la versión sea `0.x`, `feat` y los cambios incompatibles (`!` o un pie `BREAKING CHANGE:`) incrementan la versión menor, y `fix` incrementa el parche.

GitHub no ejecuta la CI en los PR que el bot abre o actualiza con el token predeterminado, así que las verificaciones obligatorias del PR de versión quedan pendientes. Agrega un secreto de repositorio `RELEASE_PLEASE_TOKEN` (un token de acceso personal con permisos de escritura en contents y pull requests), o cierra y vuelve a abrir el PR de versión para ejecutar las verificaciones. Sin el token, tendrás que volver a abrirlo después de cada actualización.

## Gentle Hub

Este repositorio tiene los topics `gentle-shell-package` y `gentle-shell-extension` para aparecer en el [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## Licencia

MIT
