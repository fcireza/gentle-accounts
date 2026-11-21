<p align="center"><img src="assets/logo-mark.svg" alt="gentle-accounts" width="100"></p>

Español | [English](README.en.md)

> Los mensajes del programa se muestran en inglés.

**Un login por cuenta, una sola vez.** Cada perfil guarda su propia sesión de Claude, Codex y Anthropic en Gentle Shell y pi. Cambiás desde el menú o con un comando y no volvés a loguearte: la barra de estado te muestra siempre qué cuenta está activa.

<p align="center">
  <a href="https://github.com/fcireza/gentle-accounts/releases"><img src="https://img.shields.io/github/v/release/fcireza/gentle-accounts?label=release&labelColor=1A1218&color=F095C8&style=for-the-badge" alt="release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-1A1218?labelColor=1A1218&color=D7A0B8&style=for-the-badge" alt="MIT"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/Pi-native-F095C8?labelColor=1A1218&style=for-the-badge" alt="Pi-native package"></a>
</p>

<p align="center">
  <a href="https://github.com/Gentleman-Programming/gentle-ai"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" height="64" alt="Built with Gentle-AI"></a>
</p>

<p align="center"><img src="assets/logo.svg" alt="gentle-accounts" width="350"></p>

![Barra de estado de Gentle Shell con el nombre del perfil activo](assets/hero-status-bar.svg)

Las imágenes son ilustraciones construidas con los mensajes reales del programa, no capturas de pantalla.

## Documentación

- [Índice](docs/es/README.md): punto de partida de la documentación.
- [Instalación](docs/es/install.md): cada sistema, Gentle Shell y pi, alias, actualizar y quitar.
- [Flujo de trabajo](docs/es/workflow.md): escenarios completos con imágenes.
- [Comandos](docs/es/commands.md): referencia completa con todos los mensajes.
- [Cómo funciona](docs/es/how-it-works.md): estructura en disco, cambio de perfil, barra de estado y seguridad.
- [Solución de problemas](docs/es/troubleshooting.md): síntomas, causas y soluciones.
- [Desarrollo](docs/es/development.md): pruebas, CI, Conventional Commits y versiones.

## Objetivo

Claude Code guarda una sola sesión por equipo, y pi guarda las credenciales de Codex y Anthropic en un único `auth.json`. gentle-accounts permite tener **perfiles** con nombre, como `work` y `personal`, cada uno con sus propias sesiones. Se cambia entre ellos con un solo comando y la barra de estado siempre muestra qué cuenta está activa.

## Cómo funciona

- Cada perfil guarda sus propias sesiones: su propia carpeta de Claude Code (`CLAUDE_CONFIG_DIR`) y su propio conjunto de credenciales del `auth.json` de pi.
- Cambiar con `/gentle:accounts <name>`, o desde el menú, las intercambia y actualiza la barra de estado, que muestra el perfil activo.
- `gentle-accounts <profile>` inicia una sesión con una carpeta del agente privada, así que dos proyectos pueden usar dos cuentas al mismo tiempo. Evite la MISMA cuenta en dos sesiones abiertas: los refresh tokens de OAuth rotan y una de ellas puede invalidarse.
- Los perfiles quedan en disco bajo `profiles/` en la carpeta del agente. Más en [Cómo funciona](docs/es/how-it-works.md).

## Proveedores

| Proveedor | Qué guarda cada perfil | Cómo iniciar sesión |
| --- | --- | --- |
| Claude Bridge (mediante [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)) | su propia sesión de Claude Code (un `CLAUDE_CONFIG_DIR` separado) | `/gentle:accounts login claude` o `gentle-accounts login <profile>` |
| Codex (`openai-codex`) | sus propias credenciales en el `auth.json` de pi | `Enter` en su fila del menú (pestaña nueva, esta terminal o mostrar el comando) |
| Anthropic (proveedor nativo de pi) | sus propias credenciales en el `auth.json` de pi | `Enter` en su fila del menú (pestaña nueva, esta terminal o mostrar el comando) |

Los proveedores con clave de API siguen siendo globales; todo proveedor de cuenta (oauth) pertenece al perfil.

## Comandos

El menú de cuentas es la forma principal de usarlo: `/gentle:accounts` lista los perfiles (`●` activo en esta sesión, `○` los demás y `★` perfil de sesión). Teclas: `↑` `↓` perfil, `→` `←` abrir o cerrar sus proveedores (`●`/`○` con sesión o sin ella), `Enter` cambiar o iniciar sesión, `n` nuevo, `r` renombrar, `d` borrar, `s` sesión, `e` correo, `x` cerrar la sesión de un proveedor, `i` adoptar un login detectado fuera de los perfiles, `o` (en un proveedor con sesión) abrir el proyecto con ese perfil en una pestaña nueva, `Esc` cerrar. En modo `fullscreen` el puntero ilumina la fila bajo el mouse; también puede hacer clic en un perfil o proveedor, doble clic para cambiar o iniciar sesión, y usar la rueda.

| Comando | Qué hace |
| --- | --- |
| `/gentle:accounts` | Abre el menú de cuentas. |
| `/gentle:accounts <name>` | Cambia a `<name>`. |
| `/gentle:accounts list` | Lista los perfiles. |
| `/gentle:accounts rename <old> <new>` | Renombra un perfil; sus sesiones se mueven con él. |
| `/gentle:accounts session [<name>\|last]` | Muestra, define o borra el perfil con el que empiezan las sesiones nuevas. |
| `/gentle:accounts email [show\|hide]` | Muestra o define si la barra de estado muestra el correo completo. |
| `gentle-accounts <name>` | Inicia `gentle-shell` con ese perfil en una carpeta de sesión privada. |
| `gentle-accounts login <name>` | Ejecuta `claude auth login` para ese perfil. |

Primer uso: crear un perfil, cambiar a él y abrir el menú para iniciar sesión.

```sh
/gentle:accounts create work
/gentle:accounts work
/gentle:accounts
```

Los demás comandos y todos los mensajes están en [Comandos](docs/es/commands.md).

## Instalar / Desinstalar

| | macOS | Linux | Windows (PowerShell) |
| --- | --- | --- | --- |
| Instalar con Gentle Shell | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` |
| Instalar con pi | `pi install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` |
| Launcher | `alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'` en `~/.zshrc` o `~/.bashrc` | `alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'` en `~/.bashrc` o `~/.zshrc` | `function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }` en `$PROFILE` |
| Desinstalar con Gentle Shell | `gentle-shell -- remove git:github.com/fcireza/gentle-accounts` | `gentle-shell -- remove git:github.com/fcireza/gentle-accounts` | `gentle-shell -- remove git:github.com/fcireza/gentle-accounts` |
| Desinstalar con pi | `pi remove git:github.com/fcireza/gentle-accounts` | `pi remove git:github.com/fcireza/gentle-accounts` | `pi remove git:github.com/fcireza/gentle-accounts` |

Requisitos: Node 22.18 o superior, pi 1.5.1 o superior (o Gentle Shell), la CLI `claude` y pi-claude-bridge para los perfiles de Claude. Desinstalar conserva sus perfiles en disco bajo `profiles/` hasta que usted borre esa carpeta. **Windows no se probó en un equipo real**, solo con pruebas automatizadas; se recomienda WSL. Detalles, actualización y el paquete anterior en [Instalación](docs/es/install.md).

## Gentle Hub

Este repositorio lleva los topics `gentle-shell-package` y `gentle-shell-extension` para aparecer en el [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

## Licencia

MIT
