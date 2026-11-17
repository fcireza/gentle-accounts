[English](../en/commands.md) | Español

# Comandos

Qué encontrará aquí: la referencia completa del comando `/gentle:accounts` y del launcher `gentle-accounts`, con cada mensaje que imprimen. Los mensajes se muestran exactamente como los imprime el código, en inglés.

## Nombres de perfil

Los nombres deben cumplir `^[a-z0-9][a-z0-9_-]{0,31}$`: letras minúsculas, dígitos, `-` o `_`, empezando por letra o dígito, hasta 32 caracteres. Un nombre inválido se rechaza y nada cambia:

```
Invalid profile name "<name>": use lowercase letters, digits, "-" or "_" (max 32 chars).
```

## Comando: `/gentle:accounts`

Disponible dentro de Gentle Shell y pi. Al presionar Tab después de `/gentle:accounts ` se completan subcomandos y nombres de perfil. Los mensajes aparecen como notificaciones.

### `/gentle:accounts`

Sin argumentos, abre un selector titulado `Switch profile` con todos los perfiles; el activo aparece con la etiqueta `(active)`. Elegir uno cambia a ese perfil, igual que `/gentle:accounts <name>`; cerrar el selector no hace nada.

- Sin perfiles: `No profiles. Create one with /gentle:accounts create <name>` (advertencia).
- Sin interfaz interactiva: muestra el texto de uso (advertencia).

### `/gentle:accounts <name>`

Cambia a `<name>`: guarda las credenciales de Codex y Anthropic del perfil que deja, carga las de `<name>`, define o elimina `CLAUDE_CONFIG_DIR`, registra el perfil activo, recarga el registro de modelos de pi y actualiza la barra de estado. Consulte [Cómo funciona](how-it-works.md).

- Éxito: `Switched to profile "<name>". Claude Code dir: <dir>`, donde `<dir>` es la carpeta de Claude del perfil o `(unset: Claude Code default)`.
- Ya activo: `Already on profile "<name>".`
- Nombre inválido: el mensaje de nombre inválido anterior (error).
- Perfil inexistente: `Profile "<name>" does not exist.` (error).
- Agente ocupado: `Wait for the current turn to finish before switching profiles.` (advertencia). La comprobación de inactividad ocurre antes de leer o escribir nada, así que nada cambia.
- Archivo de credenciales ilegible: el mensaje de error, por ejemplo `Cannot parse <path>: <reason>` (error). Todos los archivos se leen antes de escribir alguno, así que nada cambia.

Si todavía no hay un perfil activo, primero se crea `default` con sus inicios de sesión actuales, para que el cambio nunca los pierda.

### `/gentle:accounts list`

Lista los perfiles, uno por línea y en orden; `* ` marca el activo:

```
* default
  work
```

Sin perfiles: `No profiles. Create one with /gentle:accounts create <name>`.

### `/gentle:accounts current`

Muestra `Active profile: <name> (CLAUDE_CONFIG_DIR=<dir>)`, donde `<dir>` es `(unset: Claude Code default)` para `default`, y actualiza la barra de estado. Sin perfil activo: `No active profile.`

### `/gentle:accounts create <name>`

Crea un perfil vacío: una carpeta `claude/` y un `auth.json` sin credenciales. No cambia a ese perfil.

- Éxito: `Created profile "<name>". Switch with /gentle:accounts <name>, then /login for Codex or Anthropic and /gentle:accounts login claude for Claude.`
- Ya existe: `Profile "<name>" already exists.` (error).
- Nombre inválido: el mensaje de nombre inválido (error).
- Sin nombre: el texto de uso (advertencia).

### `/gentle:accounts delete <name>`

Borra la carpeta de un perfil después de un diálogo de confirmación titulado `Delete profile` que pregunta `Delete profile "<name>" and its Claude login and credentials? This cannot be undone.`

- Éxito: `Deleted profile "<name>".`
- Cancelado: `Delete cancelled.`
- Perfil activo: `Cannot delete the active profile "<name>". Switch to another profile first.` (error).
- Perfil de inicio: `Cannot delete the startup profile "<name>". Set another one or clear it with "startup last" first.` (error).
- Perfil inexistente: `Profile "<name>" does not exist.` (error).
- Sin interfaz interactiva: `Deleting needs a confirmation dialog; run it from the TUI.` (error).
- Sin nombre: el texto de uso (advertencia).

### `/gentle:accounts login claude`

Imprime, sin ejecutarlo, el comando que inicia la sesión de Claude Code del perfil activo, resaltado en su propia línea (indicador `$ `, `PS> ` en Windows):

```
To log profile "<name>" into Claude Code, run this in ANOTHER terminal (it opens your browser):

  $ <command>

Or run it from a terminal with the launcher: gentle-accounts login <name>
When it finishes, run /gentle:accounts current to see the account.
```

El comando es `claude auth login` para un perfil en la carpeta predeterminada de Claude Code, `CLAUDE_CONFIG_DIR='<dir>' claude auth login` en macOS y Linux, y `$env:CLAUDE_CONFIG_DIR="<dir>"; claude auth login` en Windows.

- Sin perfil activo: `No active profile.` (error).
- Cualquier cosa distinta de `claude` después de `login`: el texto de uso (advertencia).

### `/gentle:accounts startup [<name>|last]`

Muestra, define o borra el perfil de inicio: el perfil con el que empiezan las sesiones nuevas. Sin él, las sesiones nuevas empiezan en el último perfil usado. Consulte [Cómo funciona](how-it-works.md).

- `/gentle:accounts startup`: muestra `Startup profile: <name>`, o `Startup profile: none (new sessions start on the last used profile: <current>)`, donde `<current>` es `none` si no hay un perfil activo.
- `/gentle:accounts startup <name>`: lo define y muestra `Startup profile set to "<name>". New sessions start on it.`
- `/gentle:accounts startup last`: lo borra y muestra `Startup profile cleared. New sessions start on the last used profile.`
- Nombre inválido: el mensaje de nombre inválido (error).
- Perfil inexistente: `Profile "<name>" does not exist.` (error).

Definir el perfil de inicio no cambia el perfil de la sesión en curso. Un inicio explícito con `gentle-accounts <name>` gana para ese inicio: el launcher define `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>` para gentle-shell y la extensión omite entonces el perfil de inicio. El perfil de inicio se aplica solo cuando pi arranca, no en `/new`, `/resume`, `/fork` ni `/reload`.

### `/gentle:accounts help`

`help` y `--help` muestran el texto de uso:

```
/gentle:accounts                 pick a profile and switch to it
/gentle:accounts <name>          switch to <name>
/gentle:accounts list            list profiles (* marks the active one)
/gentle:accounts current         show the active profile
/gentle:accounts create <name>   create an empty profile
/gentle:accounts delete <name>   delete a profile (asks for confirmation)
/gentle:accounts login claude    show the command that logs the active profile into Claude Code
/gentle:accounts startup [<name>|last]  show, set or clear the profile new sessions start on
```

### Hooks de la extensión

Además del comando, la extensión registra:

- **Inicio de sesión**: crea `default` si no hay un perfil activo; si lo hay, define `CLAUDE_CONFIG_DIR` para el perfil activo salvo que el entorno ya lo defina; luego, si hay un perfil de inicio definido y no es el activo, cambia a él y muestra `Started on profile "<name>" (startup profile).`; inicia un temporizador de 60 s para actualizar el estado y lo muestra. Si no puede leer un archivo de credenciales muestra `gentle-accounts: <message>` (error) y continúa.
- **Fin del agente**: actualiza el estado después de cada turno del agente.
- **Cierre de sesión**: detiene el temporizador de 60 s.

## CLI: `gentle-accounts`

El launcher opcional (`bin/gentle-accounts.mjs`). Necesita Node 22.18 o posterior; si no, imprime `gentle-accounts needs Node 22.18 or newer (found <version>).` y termina con código 1. Trabaja sobre la carpeta del agente de `PI_CODING_AGENT_DIR`, luego `GENTLE_SHELL_HOME`, luego `~/.gentle-shell/agent`.

| Comando | Salida | Código de salida |
| --- | --- | --- |
| `gentle-accounts` | uso en stderr | 1 |
| `gentle-accounts --help`, `-h` o `help` | uso en stdout | 0 |
| `gentle-accounts list` | perfiles, `* ` marca el activo | 0 |
| `gentle-accounts current` | el nombre del perfil activo o `No active profile.` | 0 |
| `gentle-accounts create <name>` | `Created profile "<name>".` | 0, o 1 si hay error |
| `gentle-accounts login <name>` | ejecuta `claude auth login` | código de salida de `claude`, o 1 si hay error |
| `gentle-accounts startup [<name>\|last]` | muestra, define o borra el perfil de inicio | 0, o 1 si hay error |
| `gentle-accounts <name> [args...]` | inicia `gentle-shell` | código de salida de `gentle-shell`, o 1 si hay error |

Texto de uso:

```
Usage:
  gentle-accounts <name> [gentle-shell args...]   start gentle-shell with profile <name>
  gentle-accounts list                            list profiles (* marks the active one)
  gentle-accounts current                         print the active profile
  gentle-accounts create <name>                   create an empty profile
  gentle-accounts login <name>                    run `claude auth login` for that profile's Claude dir
  gentle-accounts startup [<name>|last]           show, set or clear the profile new sessions start on
  gentle-accounts --help                          show this help
```

### `gentle-accounts list`

Imprime los perfiles en orden, con `* ` delante del activo. Sin perfiles: `No profiles. Create one with: gentle-accounts create <name>`.

### `gentle-accounts current`

Imprime el nombre del perfil activo, o `No active profile.`

### `gentle-accounts create <name>`

Crea un perfil vacío e imprime `Created profile "<name>".`. Con un nombre inválido o existente imprime el error (`Invalid profile name ...` o `Profile "<name>" already exists.`) en stderr y termina con 1. Sin nombre imprime el uso en stderr y termina con 1.

### `gentle-accounts login <name>`

Ejecuta `claude auth login` conectado a la terminal, con `CLAUDE_CONFIG_DIR` apuntando a la carpeta de Claude del perfil, o eliminado para un perfil en la carpeta predeterminada de Claude Code. No cambia de perfil. Sin nombre imprime el uso; para un perfil inexistente imprime `Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`; ambos terminan con 1. Si no puede iniciar `claude` imprime `Cannot run claude: <error>` y termina con 1.

### `gentle-accounts startup [<name>|last]`

Igual que `/gentle:accounts startup`, con los mismos mensajes: sin argumento imprime el perfil de inicio, `last` lo borra y un nombre lo define. Los mensajes van a stdout con código 0; un nombre inválido (`Invalid profile name ...`) o un perfil inexistente (`Profile "<name>" does not exist.`) van a stderr con código 1.

```sh
gentle-accounts startup work   # new sessions start on "work"
gentle-accounts startup        # show it
gentle-accounts startup last   # back to the last used profile
```

### `gentle-accounts <name> [args...]`

Cambia a `<name>` con las mismas reglas que `/gentle:accounts <name>` (primero crea `default` si no hay un perfil activo) y luego inicia `gentle-shell` con los argumentos restantes y el `CLAUDE_CONFIG_DIR` del perfil (eliminado para `default`). En Windows `gentle-shell` y `claude` se inician a través de la shell para que se resuelvan los shims `.cmd`.

- Perfil inexistente: `Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`, código 1.
- Archivo de credenciales ilegible: el mensaje de error, código 1, nada cambia.
- No se puede iniciar `gentle-shell`: `Cannot run gentle-shell: <error>`, código 1.

```sh
gentle-accounts work                  # open Gentle Shell as "work"
gentle-accounts personal --isolated   # extra args are passed through
gentle-accounts login work            # log "work" into Claude
```
