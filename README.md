<p align="center"><img src="https://raw.githubusercontent.com/fcireza/gentle-accounts/main/assets/logo-mark.svg" alt="gentle-accounts" width="100"></p>

Español | [English](https://github.com/fcireza/gentle-accounts/blob/main/README.en.md)

> Los mensajes del programa se muestran en inglés.

**Un login por cuenta, una sola vez.** Cada perfil guarda su propia sesión de Claude, Codex y Anthropic en Gentle Shell y pi. Cambiás desde el menú o con un comando y no volvés a loguearte: la barra de estado te muestra siempre qué cuenta está activa.

<p align="center">
  <a href="https://github.com/fcireza/gentle-accounts/releases"><img src="https://img.shields.io/github/v/release/fcireza/gentle-accounts?label=release&labelColor=1A1218&color=F095C8&style=for-the-badge" alt="release"></a>
  <a href="https://github.com/fcireza/gentle-accounts/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-1A1218?labelColor=1A1218&color=D7A0B8&style=for-the-badge" alt="MIT"></a>
  <a href="https://pi.dev"><img src="https://img.shields.io/badge/Pi-native-F095C8?labelColor=1A1218&style=for-the-badge" alt="Pi-native package"></a>
</p>

<p align="center">
  <a href="https://github.com/Gentleman-Programming/gentle-ai"><img src="https://raw.githubusercontent.com/Gentleman-Programming/gentle-ai/main/docs/assets/brand/built-with-gentle-ai.png" height="64" alt="Built with Gentle-AI"></a>
</p>

## Documentación

- [Índice](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/README.md): punto de partida de la documentación.
- [Instalación](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/install.md): cada sistema, Gentle Shell y pi, alias, actualizar y quitar.
- [Flujo de trabajo](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/workflow.md): escenarios completos con imágenes.
- [Comandos](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/commands.md): referencia completa con todos los mensajes.
- [Cómo funciona](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/how-it-works.md): estructura en disco, cambio de perfil, barra de estado y seguridad.
- [Solución de problemas](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/troubleshooting.md): síntomas, causas y soluciones.
- [Desarrollo](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/development.md): pruebas, CI, Conventional Commits y versiones.

## Objetivo

Claude Code guarda una sola sesión por equipo, y pi guarda las credenciales de Codex y Anthropic en un único `auth.json`. gentle-accounts permite tener **perfiles** con nombre, como `work` y `personal`, cada uno con sus propias sesiones. Se cambia entre ellos con un solo comando y la barra de estado siempre muestra qué cuenta está activa.

## Cómo funciona

1. Cada perfil (`work`, `personal`…) guarda su propio login: su carpeta de Claude Code (`CLAUDE_CONFIG_DIR`) y su propio archivo de credenciales OAuth. Piense en un cajón por cuenta. En macOS y Linux el `auth.json` de pi es solo un acceso directo (un enlace) al cajón del perfil activo: cambiar de perfil mueve el acceso directo y no copia nada, y un token que pi renueva se guarda en el perfil correcto. En Windows las credenciales se siguen copiando. Un `/login` hecho directamente en pi cae en el perfil activo y reemplaza su token: para agregar otra cuenta, use el menú de cuentas o `gentle-accounts <profile>`.
2. Cambiar de perfil, con `/gentle:accounts <name>` o desde el menú, intercambia esa carpeta y esas credenciales y actualiza la barra de estado.
3. Cada proveedor se inicia sesión una sola vez por perfil; después el perfil lo recuerda, sin volver a loguearte mientras el token siga vivo.
4. `gentle-accounts <profile>` abre una sesión con una carpeta del agente privada, así dos proyectos usan dos cuentas a la vez. Evite la MISMA cuenta en dos sesiones: los refresh tokens rotan y una puede invalidarse.
5. Los perfiles quedan en disco bajo `profiles/`, dentro de la carpeta del agente. Más en [Cómo funciona](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/how-it-works.md).

![Carpetas de perfiles e intercambio de credenciales](https://raw.githubusercontent.com/fcireza/gentle-accounts/main/assets/how-it-works.svg)

## Proveedores

| Proveedor | Qué guarda cada perfil | Cómo iniciar sesión |
| --- | --- | --- |
| Claude (mediante [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge)) | su propia sesión de Claude Code (un `CLAUDE_CONFIG_DIR` separado) | `Enter` en su fila del menú: pestaña nueva (recomendada), esta terminal o mostrar el comando; o `/gentle:accounts login claude` |
| Codex (`openai-codex`) | sus propias credenciales en el `auth.json` de pi | `Enter` en su fila del menú: esta terminal (recomendada), pestaña nueva o mostrar el comando |
| Los demás logins OAuth (Anthropic y cualquier proveedor que ofrezca `/login`) | sus propias credenciales en el `auth.json` de pi | igual que Codex |

Los proveedores con clave de API siguen siendo globales; todo proveedor de cuenta (OAuth) pertenece al perfil.

## Comandos

El menú de cuentas es la forma principal de usarlo: `/gentle:accounts` lista los perfiles y, con `→`, sus proveedores; `Enter` cambia o inicia sesión, `n` crea, `r` renombra, `d` borra, `s` fija el perfil de sesión, `e` alterna el correo, `g` abre el cuadro de uso de las cuentas, `x` cierra la sesión de un proveedor, `i` adopta un login detectado, `o` abre el proyecto con ese perfil en una pestaña y `Esc` cierra. En `fullscreen` también funcionan el mouse y la rueda.

| Comando | Qué hace |
| --- | --- |
| `/gentle:accounts` | Abre el menú de cuentas. |
| `/gentle:accounts help` | Muestra el uso. |
| `/gentle:accounts <name>` | Cambia a `<name>`. |
| `/gentle:accounts list` | Lista los perfiles. |
| `/gentle:accounts create <name>` | Crea un perfil vacío. |
| `/gentle:accounts session [<name>\|last]` | Muestra, define o borra el perfil con el que empiezan las sesiones nuevas. |
| `/gentle:accounts email [show\|hide]` | Muestra u oculta el correo completo en la barra de estado. |
| `/gentle:accounts usage [on\|off]` | Abre la superposición `Account Usage` (lo que los proveedores de cada cuenta ya informaron), o la activa o desactiva. |
| `/gentle:accounts delete <name>` | Borra un perfil, con confirmación. |


Primer uso:

```sh
/gentle:accounts create work
/gentle:accounts work
/gentle:accounts
```

Todos los mensajes y el resto de los subcomandos del launcher están en [Comandos](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/commands.md).

## Instalar

Requisitos: Node 22.18 o superior, pi 1.5.1 o superior (o Gentle Shell), la CLI `claude` y pi-claude-bridge para los perfiles de Claude.

### macOS / Linux

Con Gentle Shell o con pi:

```sh
gentle-shell install git:github.com/fcireza/gentle-accounts
```

```sh
pi install git:github.com/fcireza/gentle-accounts
```

### Windows (PowerShell)

**Windows no se probó en un equipo real**, solo con pruebas automatizadas; se recomienda WSL.

```powershell
gentle-shell install git:github.com/fcireza/gentle-accounts
```

```powershell
pi install git:github.com/fcireza/gentle-accounts
```

## Desinstalar

Desinstalar conserva sus perfiles en disco bajo `profiles/` hasta que usted borre esa carpeta.

### macOS / Linux

```sh
gentle-shell remove git:github.com/fcireza/gentle-accounts
```

```sh
pi remove git:github.com/fcireza/gentle-accounts
```

### Windows (PowerShell)

```powershell
gentle-shell remove git:github.com/fcireza/gentle-accounts
```

```powershell
pi remove git:github.com/fcireza/gentle-accounts
```

Detalles, actualización y el paquete anterior en [Instalación](https://github.com/fcireza/gentle-accounts/blob/main/docs/es/install.md).

## Gentle Hub

Este repositorio lleva los topics `gentle-shell-package` y `gentle-shell-extension` para aparecer en el [Gentle Hub](https://gentlemanprogramming.com/gentle-hub/).

---

<p align="center">
  <strong>Un login por cuenta, una sola vez.</strong><br>
  Hecho para que cambiar de cuenta sea lo más fácil de tu día.<br>
  Si te sirvió, dejá una ⭐ en <a href="https://github.com/fcireza/gentle-accounts">GitHub</a>.
</p>
<p align="center"><img src="https://raw.githubusercontent.com/fcireza/gentle-accounts/main/assets/logo.svg" alt="gentle-accounts" width="350"></p>

<p align="center"><sub>By <a href="https://github.com/fcireza">@fcireza</a></sub></p>
