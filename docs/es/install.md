[English](../en/install.md) | Español

# Instalación

Qué encontrará aquí: cómo elegir entre Gentle Shell y pi, los requisitos, una sección completa por sistema, y cómo actualizar, quitar y desarrollar el paquete.

## Gentle Shell o pi

| | Gentle Shell | pi |
| --- | --- | --- |
| Para quién | usa Gentle Shell | usa pi sin Gentle Shell |
| Comando | `gentle-shell -- install git:github.com/fcireza/gentle-accounts` | `pi install git:github.com/fcireza/gentle-accounts` |
| Carpeta del agente | `~/.gentle-shell/agent` (o `GENTLE_SHELL_HOME`) | `~/.pi/agent` (o `PI_CODING_AGENT_DIR`) |

Con Gentle Shell, todo lo que va después de `--` se pasa a pi, que clona el paquete en la carpeta del agente y lo agrega al `settings.json` de esa carpeta. Las opciones de Gentle Shell, como `--home <path>`, van antes del `--`. Reinicie Gentle Shell o pi y `/gentle:accounts` queda disponible.

La extensión siempre usa la carpeta del agente que pi resuelve para la sesión en curso. El launcher (`gentle-accounts`) la resuelve por su cuenta: `PI_CODING_AGENT_DIR`, luego `GENTLE_SHELL_HOME`, luego `~/.gentle-shell/agent`. Con pi sin Gentle Shell, defina `PI_CODING_AGENT_DIR` como `~/.pi/agent` antes de usar el launcher; de lo contrario lee la carpeta de Gentle Shell. `gentle-accounts <name>` siempre inicia `gentle-shell`; con pi solo son útiles `list`, `current`, `create` y `login`.

## Requisitos

- Node 22.18 o posterior (el launcher rechaza versiones anteriores; el paquete declara `engines.node` `>=22.18`).
- pi 1.5.1 o posterior (dependencia peer `@earendil-works/pi-coding-agent`), o Gentle Shell, que incluye pi.
- La CLI `claude` en el `PATH`, para los inicios de sesión de Claude y para la barra de estado.
- [pi-claude-bridge](https://github.com/elidickinson/pi-claude-bridge) instalado en la misma carpeta del agente, para los perfiles de Claude.

## macOS

Instalación con Gentle Shell:

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

O con pi:

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `~/.gentle-shell/agent` (con pi: `~/.pi/agent`).

Ruta del clon: pi clona los paquetes git dentro de `git/` en la carpeta del agente, así que el clon queda en `~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts`. Esta ruta viene del README existente y no se verificó contra el código de pi; confírmela con:

```sh
ls ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin
```

Alias del launcher para zsh (`~/.zshrc`) o bash (`~/.bashrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

Con pi, reemplace `.gentle-shell/agent` por `.pi/agent` en la ruta del alias.

Verificación: abra Gentle Shell o pi y ejecute `/gentle:accounts list`. En una terminal nueva, `gentle-accounts --help` muestra el uso del launcher.

## Linux

Instalación con Gentle Shell:

```sh
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

O con pi:

```sh
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `~/.gentle-shell/agent` (con pi: `~/.pi/agent`).

Ruta del clon: la misma estructura que en macOS, `~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts` (del README existente, no verificada contra el código de pi). Confírmela con el mismo comando `ls`:

```sh
ls ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin
```

Alias del launcher para bash (`~/.bashrc`) o zsh (`~/.zshrc`):

```sh
alias gentle-accounts='node ~/.gentle-shell/agent/git/github.com/fcireza/gentle-accounts/bin/gentle-accounts.mjs'
```

Con pi, reemplace `.gentle-shell/agent` por `.pi/agent` en la ruta del alias.

Verificación: abra Gentle Shell o pi y ejecute `/gentle:accounts list`. En una terminal nueva, `gentle-accounts --help` muestra el uso del launcher.

## Windows (PowerShell)

Instalación con Gentle Shell:

```powershell
gentle-shell -- install git:github.com/fcireza/gentle-accounts
```

O con pi:

```powershell
pi install git:github.com/fcireza/gentle-accounts
```

Carpeta del agente: `%USERPROFILE%\.gentle-shell\agent` (con pi: `%USERPROFILE%\.pi\agent`).

Ruta del clon: `%USERPROFILE%\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts` (del README existente, no verificada contra el código de pi). Confírmela con:

```powershell
Get-ChildItem "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin"
```

Función del launcher para su perfil de PowerShell (`$PROFILE`):

```powershell
function gentle-accounts { node "$env:USERPROFILE\.gentle-shell\agent\git\github.com\fcireza\gentle-accounts\bin\gentle-accounts.mjs" @args }
```

Con pi, reemplace `.gentle-shell\agent` por `.pi\agent` en la ruta de la función.

Verificación: abra Gentle Shell o pi y ejecute `/gentle:accounts list`. En una ventana nueva de PowerShell, `gentle-accounts --help` muestra el uso del launcher.

En Windows el launcher inicia `gentle-shell` y `claude` a través de la shell, para que se resuelvan los shims `.cmd` del `PATH`.

## Actualizar

Reinstalar descarga la última versión de `main`: ejecute de nuevo el mismo comando de instalación. pi también documenta `pi update --extensions` para sincronizar los paquetes instalados.

## Quitar

Borre la línea `git:github.com/fcireza/gentle-accounts` de la lista `packages` del `settings.json` de la carpeta del agente (`~/.gentle-shell/agent/settings.json` para Gentle Shell) y reinicie. pi también documenta `pi remove <source>`. Los perfiles quedan en disco dentro de `profiles/` en la carpeta del agente hasta que borre esa carpeta.

## Paquete anterior

El paquete se llamaba `gentle-profiles`. Si lo instaló (`git:github.com/fcireza/gentle-profiles`), primero quite esa línea de la lista `packages` de `settings.json`. Con ambos instalados, el antiguo `/profile` y el nuevo `/gentle:accounts` funcionan a la vez. El comando `/profile` pasó a ser `/gentle:accounts` con los mismos subcomandos, y el launcher pasó a ser `gentle-accounts`. Los perfiles en disco no cambian.

## Instalar desde un clon local

Para desarrollar, clone el repositorio y cárguelo desde su carpeta. pi documenta rutas locales para paquetes: `pi install ./local-package` lo agrega a `settings.json`, y `pi -e <source>` lo carga por una sola ejecución sin tocar la configuración. Para no mezclarlo con sus perfiles reales, apunte pi a una carpeta del agente desechable:

```sh
git clone https://github.com/fcireza/gentle-accounts.git
cd gentle-accounts
pnpm install
PI_CODING_AGENT_DIR="$(mktemp -d)" pi -e .
```

Consulte [Desarrollo](development.md) para los tests y la CI.
