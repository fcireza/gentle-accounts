Español | [English](README.en.md)

> Los mensajes del programa se muestran en inglés.

# gentle-accounts

> **Antes se llamaba gentle-profiles.** El comando `/profile` ahora es `/gentle:accounts` (con los mismos subcomandos), el lanzador es `gentle-accounts` y el repositorio de GitHub cambió de nombre a `fcireza/gentle-accounts` (las URL anteriores redirigen). Tus perfiles en disco no cambian.

## Objetivo

Claude Code guarda una sola sesión por equipo, y pi guarda las credenciales de Codex y Anthropic en un único `auth.json`, así que de entrada se trabaja con una cuenta por proveedor. gentle-accounts permite tener **perfiles** con nombre, como `work` y `personal`, cada uno con sus propias sesiones. Se cambia entre ellos con un solo comando y siempre se ve qué cuenta está activa. Funciona igual en Linux, macOS y Windows, como extensión de pi o dentro de [Gentle Shell](https://gentlemanprogramming.com/gentle-hub/).

## Proveedores

Gentle Shell se comunica con Claude a través de [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge), que usa la sesión iniciada en la CLI `claude`. Este paquete le da a cada perfil su propia carpeta y sus propias credenciales, y las intercambia al cambiar de perfil:

| Proveedor | Qué guarda cada perfil | Cómo iniciar sesión |
| --- | --- | --- |
| Claude (mediante claude-bridge) | su propia sesión de Claude Code (un `CLAUDE_CONFIG_DIR` separado) | ejecutar en otra terminal el comando que muestra `/gentle:accounts login claude`, o `gentle-accounts login <profile>` |
| Codex (`openai-codex`) | sus propias credenciales en el `auth.json` de pi | el `/login` de pi |
| Anthropic (proveedor nativo de pi) | sus propias credenciales en el `auth.json` de pi | el `/login` de pi |

Cualquier otro proveedor configurado en pi queda intacto. La barra de estado siempre muestra el perfil activo y su cuenta enmascarada:

```
status bar:   gentle-accounts: work · you****@company.com
```

## Flujo de trabajo

Ejemplo completo para alguien con una cuenta de Claude del trabajo y otra personal:

1. Instala el paquete (consulta Instalación más abajo) y reinicia Gentle Shell o pi.
2. En el primer inicio, las sesiones actuales se agrupan en un perfil llamado `default`. No se mueve ni se copia nada: `default` sigue usando la carpeta predeterminada de Claude Code con `CLAUDE_CONFIG_DIR` **sin definir** (definirla como `~/.claude` haría que Claude Code perdiera la sesión en macOS, donde la entrada del llavero depende de esa variable). Si ya se había definido `CLAUDE_CONFIG_DIR`, esa carpeta se registra y se conserva. En este ejemplo, `default` es la cuenta personal.
3. Crea un perfil para el trabajo:
   ```
   /gentle:accounts create work
   ```
4. Cambia a ese perfil:
   ```
   /gentle:accounts work
   ```
5. Inicia sesión en Claude con ese perfil:
   ```
   /gentle:accounts login claude
   ```
   Esto muestra un comando; cópialo y ejecútalo en **otra terminal**, porque abre el navegador. La carpeta de Claude del perfil es `~/.gentle-shell/agent/profiles/work/claude`. En macOS o Linux la salida se ve así:
   ```
   To log profile "work" into Claude Code, run this in ANOTHER terminal (it opens your browser):

     $ CLAUDE_CONFIG_DIR='/Users/you/.gentle-shell/agent/profiles/work/claude' claude auth login

   Or run it from a terminal with the launcher: gentle-accounts login work
   When it finishes, run /gentle:accounts current to see the account.
   ```
   En Windows (PowerShell):
   ```
   To log profile "work" into Claude Code, run this in ANOTHER terminal (it opens your browser):

     PS> $env:CLAUDE_CONFIG_DIR="C:\Users\you\.gentle-shell\agent\profiles\work\claude"; claude auth login

   Or run it from a terminal with the launcher: gentle-accounts login work
   When it finishes, run /gentle:accounts current to see the account.
   ```
   O ejecuta el lanzador directamente desde una terminal:
   ```sh
   gentle-accounts login work
   ```
   El inicio de sesión no se lanza desde dentro de la TUI a propósito: `claude auth login` es interactivo (un flujo en el navegador) y la TUI controla la terminal. El comando del lanzador es la forma de ejecutarlo directamente.
6. Si usas Codex o Anthropic, inicia sesión en este perfil con el `/login` habitual de pi.
7. Comprueba la cuenta:
   ```
   /gentle:accounts current
   ```
   La barra de estado muestra `gentle-accounts: work · you****@company.com` (o `gentle-accounts: <profile> · not logged in` si no hay sesión).
8. Vuelve a la cuenta personal cuando quieras:
   ```
   /gentle:accounts default
   ```
9. Para iniciar una sesión directamente en un perfil, usa el lanzador:
   ```sh
   gentle-accounts work
   ```

## Instalación

| | Gentle Shell | pi sin Gentle Shell |
| --- | --- | --- |
| Para quién | quien usa Gentle Shell | quien usa pi sin Gentle Shell |
| Comando | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` |
| Se instala en | `~/.gentle-shell/agent` (o `GENTLE_SHELL_HOME`) | la carpeta del agente de pi, `~/.pi/agent` (o `PI_CODING_AGENT_DIR`) |

Con Gentle Shell, todo lo que va después de `--` se pasa a pi, que clona el paquete en la carpeta del agente y lo agrega al `settings.json` de esa carpeta. Las opciones de Gentle Shell, como `--home <path>`, van antes del `--`. Al reiniciar, `/gentle:accounts` queda disponible.

El lanzador `gentle-accounts` es opcional: instalar desde git no lo agrega al `PATH`, así que conviene crear un alias. Con pi sin Gentle Shell, reemplaza `.gentle-shell/agent` por `.pi/agent` en la ruta del alias.

### macOS

Requisitos: Node 22.18 o superior, la CLI `claude` y pi-claude-bridge para los perfiles de Claude (pi 1.5.1 o superior).

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `~/.gentle-shell/agent`. Alias del lanzador para zsh (`~/.zshrc`) o bash (`~/.bashrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

Comprueba la instalación dentro de Gentle Shell o pi con `/gentle:accounts list`.

### Linux

Requisitos: Node 22.18 o superior, la CLI `claude` y pi-claude-bridge para los perfiles de Claude (pi 1.5.1 o superior).

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `~/.gentle-shell/agent`. Alias del lanzador para bash (`~/.bashrc`) o zsh (`~/.zshrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

Comprueba la instalación dentro de Gentle Shell o pi con `/gentle:accounts list`.

### Windows (PowerShell)

Requisitos: Node 22.18 o superior, la CLI `claude` y pi-claude-bridge para los perfiles de Claude (pi 1.5.1 o superior).

```powershell
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

```powershell
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `%USERPROFILE%\.gentle-shell\agent`. Función del lanzador para el perfil de PowerShell (`$PROFILE`):

```powershell
function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }
```

Comprueba la instalación dentro de Gentle Shell o pi con `/gentle:accounts list`.

### Paquete anterior

Si instalaste el paquete anterior (`git:github.com/fcireza/gentle-profiles`), primero elimina esa línea de la lista `packages` en `~/.gentle-shell/agent/settings.json`. Con ambos instalados, el antiguo `/profile` y el nuevo `/gentle:accounts` funcionarían al mismo tiempo.

### Actualizar y desinstalar

Reinstalar descarga la versión más reciente de `main`. Para desinstalarlo, elimina la línea `git:github.com/fcireza/gentle-accounts` de la lista `packages` en `~/.gentle-shell/agent/settings.json`. Los perfiles permanecen en disco dentro de `profiles/` hasta que se borre esa carpeta.

## Comandos

### Dentro de Gentle Shell o pi: `/gentle:accounts`

| Comando | Qué hace |
| --- | --- |
| `/gentle:accounts` | Abre un selector con tus perfiles y cambia al que elijas. |
| `/gentle:accounts <name>` | Cambia a `<name>`. Si ya está activo, muestra: `Already on profile "<name>".` |
| `/gentle:accounts list` | Lista los perfiles. `*` marca el activo. |
| `/gentle:accounts current` | Muestra el perfil activo y su carpeta de Claude (`Active profile: work (CLAUDE_CONFIG_DIR=...)`; para `default`: `CLAUDE_CONFIG_DIR=(unset: Claude Code default)`) y actualiza la barra de estado. |
| `/gentle:accounts create <name>` | Crea un perfil vacío. |
| `/gentle:accounts delete <name>` | Elimina un perfil después de pedir confirmación. No se puede eliminar el perfil activo. |
| `/gentle:accounts login claude` | Muestra, resaltado en su propia línea, el comando que inicia sesión en Claude Code con el perfil activo (simplemente `claude auth login` para `default`). No lo ejecuta. |
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

Cada merge a `main` crea una etiqueta `vX.Y.Z` y un GitHub Release con notas generadas. No hay PR de versión ni token que configurar: el workflow usa el `GITHUB_TOKEN` predeterminado.

`main` solo acepta Pull Requests fusionados con squash, así que el título del PR se convierte en el mensaje del commit y decide el incremento de versión. Usa un título según [Conventional Commits](https://www.conventionalcommits.org/) (`feat: ...`, `fix: ...`, `docs: ...`). Una verificación lo exige.

| Commit | `0.x` | Desde `1.0.0` |
| --- | --- | --- |
| `feat: ...` | menor | menor |
| `fix: ...` y cualquier otro | parche | parche |
| `feat!: ...`, `fix!: ...` o un pie `BREAKING CHANGE:` | menor | mayor |

La primera versión es `0.1.0`. `scripts/next-version.ts` calcula la siguiente versión:

```sh
node scripts/next-version.ts
```

El campo `version` de `package.json` no se reescribe en `main`; la etiqueta es la fuente de verdad.

Ojo: el cuerpo del PR también cuenta. Una línea que empiece con `BREAKING CHANGE:` sube la versión, aunque solo la cites como ejemplo.

## Gentle Hub

Este repositorio tiene los topics `gentle-shell-package` y `gentle-shell-extension` para aparecer en el [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## Licencia

MIT
