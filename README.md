<p align="center"><img src="assets/logo.svg" alt="gentle-accounts" width="520"></p>

Español | [English](README.en.md)

> Los mensajes del programa se muestran en inglés.

Varias cuentas de Claude, Codex y Anthropic en Gentle Shell y pi, con un solo comando para cambiar entre ellas.

[![CI](https://github.com/fcireza/gentle-accounts/actions/workflows/ci.yml/badge.svg)](https://github.com/fcireza/gentle-accounts/actions/workflows/ci.yml) [![Release](https://img.shields.io/github/v/release/fcireza/gentle-accounts)](https://github.com/fcireza/gentle-accounts/releases)

> **Antes se llamaba gentle-profiles.** El comando `/profile` ahora es `/gentle:accounts`.

![Barra de estado de Gentle Shell con el perfil activo y su cuenta enmascarada](assets/hero-status-bar.svg)

Las imágenes son ilustraciones construidas con los mensajes reales del programa, no capturas de pantalla.

## Objetivo

Claude Code guarda una sola sesión por equipo, y pi guarda las credenciales de Codex y Anthropic en un único `auth.json`. gentle-accounts permite tener **perfiles** con nombre, como `work` y `personal`, cada uno con sus propias sesiones. Se cambia entre ellos con un solo comando y la barra de estado siempre muestra qué cuenta está activa.

## Proveedores

| Proveedor | Qué guarda cada perfil | Cómo iniciar sesión |
| --- | --- | --- |
| Claude (mediante [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)) | su propia sesión de Claude Code (un `CLAUDE_CONFIG_DIR` separado) | `/gentle:accounts login claude` o `gentle-accounts login <profile>` |
| Codex (`openai-codex`) | sus propias credenciales en el `auth.json` de pi | el `/login` de pi |
| Anthropic (proveedor nativo de pi) | sus propias credenciales en el `auth.json` de pi | el `/login` de pi |

Cualquier otro proveedor configurado en pi queda intacto.

## Inicio rápido

Instalar en Gentle Shell y reiniciarlo:

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

1. Crear un perfil: `/gentle:accounts create work`
2. Cambiar a ese perfil: `/gentle:accounts work`
3. Iniciar sesión: abrir el menú con `/gentle:accounts`, elegir la fila del proveedor y presionar Enter. Claude inicia sesión en una pestaña nueva de la terminal, en la misma terminal o mostrando el comando; Codex y Anthropic usan el `/login` de pi.
4. Comprobar la cuenta: `/gentle:accounts current`. La barra de estado muestra `👤 gentle-accounts: work · mari****@company.com` (`🔒` y `not logged in` si no hay sesión). El correo aparece enmascarado de forma predeterminada; `/gentle:accounts email show` lo muestra completo (visible para cualquiera que vea su pantalla).
5. Opcional: `/gentle:accounts startup work` hace que las sesiones nuevas empiecen en `work`; `/gentle:accounts startup last` vuelve al último perfil usado.

![Listar perfiles y cambiar de perfil con /gentle:accounts](assets/workflow-switch.svg)

![El comando de inicio de sesión de Claude resaltado para macOS, Linux y Windows](assets/workflow-login.svg)

Desde una terminal, `gentle-accounts login <profile>` ejecuta directamente el inicio de sesión de Claude.

## Menú de cuentas

`/gentle:accounts menu` (o simplemente `/gentle:accounts`) abre un panel con una pestaña por perfil: `◉` activo en esta sesión, `★` perfil de inicio y `●`/`○` por proveedor. Teclas: `←` `→` perfil, `↑` `↓` fila, `Enter` cambiar o iniciar sesión, `n` nuevo, `d` borrar, `s` inicio, `e` correo, `o` abrir el proyecto con ese perfil en una pestaña nueva, `Esc` cerrar.

## Una cuenta distinta en cada sesión

`gentle-accounts <profile>` ejecuta cada sesión con una carpeta del agente privada, así que dos proyectos pueden usar dos cuentas al mismo tiempo. Las sesiones iniciadas sin el launcher siguen usando el perfil global. Los refresh tokens de OAuth rotan: la MISMA cuenta en dos sesiones abiertas puede invalidar una de ellas, así que es preferible usar una cuenta distinta en cada sesión.

## Instalación

| | Gentle Shell | pi sin Gentle Shell |
| --- | --- | --- |
| Comando | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` |
| Carpeta del agente | `~/.gentle-shell/agent` (o `GENTLE_SHELL_HOME`) | `~/.pi/agent` (o `PI_CODING_AGENT_DIR`) |

Requisitos: Node 22.18 o superior, pi 1.5.1 o superior (o Gentle Shell), la CLI `claude` y pi-claude-bridge para los perfiles de Claude.

### macOS

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `~/.gentle-shell/agent`. Alias del lanzador para zsh (`~/.zshrc`) o bash (`~/.bashrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

### Linux

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `~/.gentle-shell/agent`. Alias del lanzador para bash (`~/.bashrc`) o zsh (`~/.zshrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

### Windows (PowerShell)

```powershell
gentle-shell -- install git:github.com/fcireza/gentle-accounts
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `%USERPROFILE%\.gentle-shell\agent`. Función del lanzador para el perfil de PowerShell (`$PROFILE`):

```powershell
function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }
```

Para más detalles, actualizar, desinstalar o quitar el paquete anterior, consultar [Instalación](docs/es/install.md).

## Comandos

| Dentro de Gentle Shell o pi | Qué hace |
| --- | --- |
| `/gentle:accounts` | Abre el menú de cuentas (un selector sin la TUI). |
| `/gentle:accounts menu` | Abre el menú de cuentas. |
| `/gentle:accounts <name>` | Cambia a `<name>`. |
| `/gentle:accounts list` | Lista los perfiles; `*` marca el activo. |
| `/gentle:accounts current` | Muestra el perfil activo y actualiza la barra de estado. |
| `/gentle:accounts create <name>` | Crea un perfil vacío. |
| `/gentle:accounts delete <name>` | Elimina un perfil, previa confirmación. |
| `/gentle:accounts login claude` | Muestra el comando de inicio de sesión en Claude del perfil activo. |
| `/gentle:accounts startup [<name>\|last]` | Muestra, define o borra el perfil con el que empiezan las sesiones nuevas. |
| `/gentle:accounts email [show\|hide]` | Muestra o define si la barra de estado muestra el correo completo. |
| `/gentle:accounts help` | Muestra la lista de comandos. |

| Desde la terminal | Qué hace |
| --- | --- |
| `gentle-accounts <name> [args...]` | Inicia `gentle-shell` con ese perfil en una carpeta privada para la sesión. |
| `gentle-accounts list` | Lista los perfiles. |
| `gentle-accounts current` | Muestra el perfil activo. |
| `gentle-accounts create <name>` | Crea un perfil vacío. |
| `gentle-accounts login <name>` | Ejecuta `claude auth login` para ese perfil. |
| `gentle-accounts startup [<name>\|last]` | Igual que `/gentle:accounts startup`. |
| `gentle-accounts email [show\|hide]` | Igual que `/gentle:accounts email`. |
| `gentle-accounts --help` | Muestra la lista de comandos. |

La referencia completa, con cada mensaje, está en [Comandos](docs/es/commands.md).

## Documentación

- [Índice](docs/es/README.md): punto de partida de la documentación.
- [Instalación](docs/es/install.md): cada sistema, Gentle Shell y pi, alias, actualizar y desinstalar.
- [Flujo de trabajo](docs/es/workflow.md): escenarios completos con imágenes.
- [Comandos](docs/es/commands.md): referencia completa con cada mensaje.
- [Cómo funciona](docs/es/how-it-works.md): estructura en disco, cambio de perfil, barra de estado y seguridad.
- [Solución de problemas](docs/es/troubleshooting.md): síntomas, causas y soluciones.
- [Desarrollo](docs/es/development.md): tests, CI, Conventional Commits y versiones.
- [Antigravity](docs/es/antigravity.md): plan para varias cuentas de Antigravity (Google) (no implementado).

## Gentle Hub

Este repositorio tiene los topics `gentle-shell-package` y `gentle-shell-extension` para aparecer en el [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## Licencia

MIT
