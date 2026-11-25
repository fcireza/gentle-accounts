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

Sin argumentos, abre el menú de cuentas (igual que `/gentle:accounts menu`) cuando la TUI interactiva está disponible. En los modos RPC, print o json abre en su lugar un selector titulado `Switch profile` con todos los perfiles; el activo aparece con la etiqueta `(active)`. Elegir uno cambia a ese perfil, igual que `/gentle:accounts <name>`; cerrar el selector no hace nada.

- Sin perfiles (selector): `No profiles. Create one with /gentle:accounts create <name>` (advertencia).
- Sin interfaz interactiva: muestra el texto de uso (advertencia).

### `/gentle:accounts menu`

Abre el menú de cuentas, un panel superpuesto al estilo del panel `/gentle:profiles` de Gentle Shell. Es un panel de cerca del 60% de la columna del chat, centrado en ella: cuando Gentle Shell muestra su barra lateral el panel queda a su lado y no en toda la terminal, con el título `Gentle Accounts` centrado en el borde superior y las pistas de teclas abajo; en terminales angostas pasa a un diseño compacto. Sin la TUI interactiva usa el selector `Switch profile`.

- Encabezado: `Account Default`, el perfil de sesión con el que empiezan las sesiones nuevas (`none` si no está definido) y `Account Session`, el perfil que usa esta sesión (el del `●` verde). El marco y las líneas usan el color `borderAccent` del tema.
- Una fila por perfil: `●` marca el perfil activo en esta sesión, `○` los demás y `★` el perfil por defecto (de sesión), seguidos de los proveedores con sesión iniciada. La lista muestra ocho perfiles a la vez y se desplaza; `↑ N more` y `↓ N more` cuentan los ocultos.
- Proveedores: `→` sobre el perfil seleccionado abre una fila por proveedor (Claude, Codex, Anthropic y cada proveedor que ofrece `/login`, con o sin sesión, más cualquiera con sesión en cualquier perfil o en el archivo en vivo) con `●` si hay sesión iniciada u `○` si no, primero las que tienen sesión, y `←` las cierra. El correo aparece solo en esas filas (en Codex y los demás proveedores OAuth, solo si la credencial guardada lo trae) y solo cuando se muestra el correo, con el nombre enmascarado después de tres caracteres y el dominio tal cual, por ejemplo `mar****@company.com`; mientras está oculto no aparece nada después de `logged in`. Abrir el menú nunca ejecuta `claude auth status` por perfil: reutiliza el resultado de la barra de estado para el perfil activo y lee archivos para los demás.
- Pistas de teclas: las flechas (`↑↓`, `→←`, `enter`) en su propia línea y los comandos (`n`, `r`, `d`, `u`, `e`, `esc`...) en la siguiente. Cada línea usa etiquetas cortas (`⏎ ok`, `del`, `session`) cuando las completas no entran; si no, los comandos se reparten en grupos.
- Logins detectados: una línea `Detected login:` por cada login hallado fuera de los perfiles (ver `i` más abajo).
- Sin perfiles: `no profiles yet: press n to create one`.

| Tecla | Acción |
| --- | --- |
| `↑` `↓` o `j` `k` | Perfil anterior o siguiente; con los proveedores abiertos, proveedor anterior o siguiente. |
| `→` o `l` | Abre los proveedores del perfil seleccionado. |
| `←` o `h` | Cierra los proveedores. |
| `Enter` | En un perfil: cambia a él (mismas reglas y mensajes que `/gentle:accounts <name>`). En una fila de proveedor: inicia sesión en ese proveedor. |
| `n` | Perfil nuevo (pide el nombre con `New profile name`; mismos mensajes que `create`). |
| `d` | Borra el perfil seleccionado (misma confirmación y rechazos que `delete`). |
| `r` | Renombra el perfil seleccionado (pide el nuevo nombre con `Rename profile "<name>" to`, con el nombre actual ya escrito; una respuesta vacía, igual o cancelada no hace nada; mismos mensajes que `rename`). |
| `i` | Adopta el login detectado como un perfil nuevo (pide un nombre con `Name for the detected login`). Solo mientras el menú muestra una línea `Detected login:`; el hint `i adopt` aparece solo entonces. Un login en vivo no se puede adoptar mientras el archivo de credenciales está enlazado (macOS y Linux): responde `Cannot adopt a live login while the credentials file is linked to a profile: a login made there is saved in the current profile.` Adoptar un login de Claude detectado sigue funcionando. |
| `u` | Use session: este chat usa solo el perfil seleccionado, sin cambiar las otras ventanas. Dentro de una sesión iniciada con `gentle-accounts` es el cambio propio de esa sesión. En una ventana normal la carpeta del agente de pi queda fija al arrancar, así que el chat sigue en `gentle-accounts <profile> --session <this chat>` en la misma terminal (una carpeta de sesión privada) y esta ventana se cierra cuando termina. Necesita `gentle-accounts` en el `PATH`, espera a que el turno esté en reposo necesita un chat con archivo de sesión (no efímero), deja esta ventana abierta con un mensaje si el launcher falla y todavía no está disponible en Windows. |
| `f` | Default: define el perfil seleccionado como perfil por defecto (de sesión) `★`, o lo borra si ya lo es. |
| `e` | Alterna la visualización del correo (mismos mensajes que `email show` y `email hide`). |
| `g` | Abre la superposición `Account Usage` (vea `/gentle:accounts usage`). Solo mientras el cuadro de uso está activado; la pista de tecla `g usage` aparece solo entonces. Al cerrarla vuelve al menú sobre el mismo perfil. |
| `o` | Abre este proyecto con el perfil seleccionado en una pestaña nueva de la terminal. Solo en una fila de proveedor con sesión iniciada; la pista `o open in tab` aparece solo ahí. |
| `x` | Cierra la sesión del proveedor seleccionado en ese perfil (pide confirmación; borra sus credenciales solo de ese perfil, el token solo se olvida en esta máquina). Solo en una fila de proveedor con sesión; para Claude pide confirmación y ejecuta `claude auth logout` con el `CLAUDE_CONFIG_DIR` del perfil, y en la carpeta predeterminada cierra la sesión de todos los perfiles que la comparten). |
| `Esc` o `Ctrl+C` | Cierra. |

Mouse, solo en modo `fullscreen` (en el modo normal la terminal es dueña del mouse y solo se usa el teclado): pasar el puntero sobre una fila o una pista de comando la ilumina (dentro del perfil abierto la sigue; los otros perfiles se seleccionan con un clic), un clic selecciona el perfil o proveedor bajo el puntero, un doble clic actúa como `Enter` y la rueda se mueve como `↑` `↓`. Un clic sobre una pista de teclas (`n`, `r`, `d`, `u`, `e`, `g`, `i`, `o`, `x`, `esc`) hace lo mismo que pulsar esa tecla; un clic sobre `Account Default` o `Account Session` selecciona ese perfil, sobre `↑ N more` / `↓ N more` selecciona el perfil oculto vecino y sobre la línea del login detectado lo adopta. Los clics sobre el marco y las líneas no hacen nada.

Los mensajes aparecen dentro del menú, porque las notificaciones quedan ocultas detrás de él.

Iniciar sesión en Claude desde su fila pregunta `Log profile "<name>" into Claude Code` con tres opciones (la recomendada lleva la marca `(recommended)`: `In a new terminal tab` para Claude, `In this terminal` para los demás proveedores):

- `In a new terminal tab`: ejecuta `claude auth login` con el `CLAUDE_CONFIG_DIR` del perfil (eliminado para `default`) en una pestaña nueva y muestra `Opened a new terminal tab (<terminal>) to log profile "<name>" into Claude Code. When it finishes, run /gentle:accounts current to see the account.` Terminales admitidas, en orden de detección: Windows Terminal (`wt`) en Windows; tmux (`$TMUX`); Terminal.app e iTerm2 en macOS (según `TERM_PROGRAM`); gnome-terminal, konsole, kitty y wezterm en Linux. Si no se puede abrir una pestaña, muestra `Could not open a new terminal tab.` seguido del comando de inicio de sesión de `/gentle:accounts login claude`.
- `In this terminal`: detiene la TUI, ejecuta `claude auth login` en la misma terminal (Ctrl+C va a `claude`) y restaura la TUI al terminar. Luego recarga el registro de modelos y la barra de estado y muestra `Claude Code login finished for profile "<name>".`, `claude auth login exited with code <code>.`, `claude auth login was stopped by <signal>.` o `Could not run claude auth login: <error>`.
- `Show the command`: muestra el comando de inicio de sesión de `/gentle:accounts login claude`.

Codex, Anthropic y los demás proveedores OAuth preguntan dónde iniciar sesión, con las mismas tres opciones que Claude Code: `In a new terminal tab` y `Show the command` inician `gentle-accounts <name>` (una sesión en ese perfil; escriba `/login` allí y elija el proveedor, y el login queda en el perfil cuando la sesión termina), y `In this terminal` ejecuta aquí mismo el login propio del proveedor (el mismo flujo que `/login`), cambiando antes al perfil si no es el activo, abriendo el enlace en el navegador y guardando las credenciales en ese perfil. Resultados: `Logged <provider> into profile "<name>".`, `Could not log <provider> in: <reason>` (error, no se escribe nada; un login que nadie completa vence a los 5 minutos), o `<provider> has no OAuth login here: run /login and choose it for the active profile.` (advertencia).

`o` ejecuta `gentle-accounts <name>` en una pestaña nueva en la carpeta actual y muestra `Opened "<name>" in a new terminal tab (<terminal>): gentle-accounts <name>`. Si no se puede abrir una pestaña, muestra `Open this project with "<name>" in a new terminal: gentle-accounts <name>`. El alias o la función del launcher debe estar disponible en la pestaña nueva (consulte [Instalación](install.md)).

### `/gentle:accounts <name>`

Cambia a `<name>`: guarda las credenciales de cuenta (Codex, Anthropic y cualquier otro login oauth) del perfil que deja, carga las de `<name>`, define o elimina `CLAUDE_CONFIG_DIR`, registra el perfil activo, recarga el registro de modelos de pi y actualiza la barra de estado. Consulte [Cómo funciona](how-it-works.md).

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
- Nombre reservado (`menu`, `list`, `current`, `create`, `delete`, `login`, `rename`, `session`, `startup`, `email`, `usage`, `help`): `"<name>" is a reserved word (it is a subcommand). Pick another profile name.` (error). Estas palabras son subcomandos, así que un perfil con uno de estos nombres no se podría activar con `/gentle:accounts <name>`. Un perfil que ya tiene un nombre así sigue funcionando desde el menú y el selector. `session` y `rename` pasaron a ser palabras reservadas en esta versión: un perfil que ya había creado con uno de esos nombres sigue en disco, pero ya no se puede activar por nombre. `rename` todavía lo acepta como nombre anterior, por ejemplo `/gentle:accounts rename session work`.
- Sin nombre: el texto de uso (advertencia).

### `/gentle:accounts delete <name>`

Borra la carpeta de un perfil después de un diálogo de confirmación titulado `Delete profile` que pregunta `Delete profile "<name>" and its Claude login and credentials? This cannot be undone.`

- Éxito: `Deleted profile "<name>".`
- Cancelado: `Delete cancelled.`
- Perfil activo: `Cannot delete the active profile "<name>". Switch to another profile first.` (error).
- Perfil de sesión: `Cannot delete the session profile "<name>". Set another one or clear it with "session last" first.` (error).
- Perfil inexistente: `Profile "<name>" does not exist.` (error).
- Sin interfaz interactiva: `Deleting needs a confirmation dialog; run it from the TUI.` (error).
- Sin nombre: el texto de uso (advertencia).

### `/gentle:accounts rename <old> <new>`

Renombra un perfil. Su carpeta se mueve en un solo paso atómico, así que el inicio de sesión de Claude y las credenciales van con ella y no se copia nada. El perfil activo y el perfil de sesión siguen al nombre nuevo, `CLAUDE_CONFIG_DIR` de esta sesión sigue apuntando a la carpeta de Claude movida y la barra de estado se actualiza.

- Éxito: `Renamed profile "<old>" to "<new>".`
- Si era el perfil activo, el mensaje de éxito agrega: `Other open sessions that use it keep the old path until they switch or restart.` Esas sesiones siguen con la ruta anterior de la carpeta de Claude.
- Perfil inexistente: `Profile "<old>" does not exist.` (error).
- Mismo nombre: `The new name is the same as the current one.` (error).
- Nombre nuevo inválido o reservado: el mensaje de nombre inválido o el de nombre reservado (error).
- Ya existe: `Profile "<new>" already exists.` (error).
- En uso: `Cannot rename profile "<old>": a session started with gentle-accounts is using it. Close it first.` (error). Solo cuentan las sesiones que siguen en marcha; las que ya perdieron su launcher se terminan primero, así que sus credenciales se guardan con el nombre anterior.
- Faltan palabras o sobran: el texto de uso (advertencia).

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

### `/gentle:accounts session [<name>|last]`

Muestra, define o borra el perfil de sesión: el perfil con el que empiezan las sesiones nuevas. Sin él, las sesiones nuevas empiezan en el último perfil usado. Consulte [Cómo funciona](how-it-works.md). `startup` sigue funcionando como alias de `session`, con el mismo comportamiento y salida. «Perfil de sesión» significa el perfil con el que empiezan las sesiones nuevas, no el home privado por sesión que crea el launcher.

- `/gentle:accounts session`: muestra `Session profile: <name>`, o `Session profile: none (new sessions start on the last used profile: <current>)`, donde `<current>` es `none` si no hay un perfil activo.
- `/gentle:accounts session <name>`: lo define y muestra `Session profile set to "<name>". New sessions start on it.`
- `/gentle:accounts session last`: lo borra y muestra `Session profile cleared. New sessions start on the last used profile.`
- Nombre inválido: el mensaje de nombre inválido (error).
- Perfil inexistente: `Profile "<name>" does not exist.` (error).

Definir el perfil de sesión no cambia el perfil de la sesión en curso. Un inicio explícito con `gentle-accounts <name>` gana para ese inicio: el launcher define `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>` para gentle-shell y la extensión omite entonces el perfil de sesión. El perfil de sesión se aplica solo cuando pi arranca, no en `/new`, `/resume`, `/fork` ni `/reload`.

### `/gentle:accounts email [show|hide]`

Muestra o define si la barra de estado muestra el correo completo del perfil activo. De forma predeterminada está oculto y la barra de estado muestra solo el nombre del perfil.

- `/gentle:accounts email`: muestra `Email display: hidden (not shown in the status bar)` o `Email display: shown (full email in the status bar)`.
- `/gentle:accounts email show`: lo define y muestra `Email display set to shown. The status bar shows the full email.`
- `/gentle:accounts email hide`: lo define y muestra `Email display set to hidden. The status bar does not show the email.`
- Cualquier otro argumento, o palabras extra después de `show` o `hide`: `Usage: /gentle:accounts email [show|hide]` (advertencia). Nada cambia.
- No se puede escribir el archivo de configuración: `Could not save the email display setting (<code>).` (error), donde `<code>` es el código de error del sistema (por ejemplo `EACCES`). Nada cambia.

Después de `show` o `hide` la barra de estado se actualiza de inmediato. La opción es global para la carpeta del agente (`profiles/settings.json`, consulte [Cómo funciona](how-it-works.md)) y se lee en cada actualización del estado, así que un cambio hecho desde la CLI aparece en una sesión abierta en su siguiente actualización. Estos mensajes nunca contienen el correo.

Advertencia: con `show`, cualquier persona que vea su pantalla puede leer la dirección completa, incluso al compartir pantalla, en capturas de pantalla y en grabaciones.

### `/gentle:accounts usage [on|off]`

Abre la superposición `Account Usage`: un panel con marco, con el mismo estilo del menú de cuentas, con un bloque por perfil. `●` marca el perfil que usa esta sesión y `○` los demás. Bajo cada perfil hay una fila por proveedor que ya informó su uso (nombre del proveedor, plan si se conoce y `updated <time> ago`) y, por cada ventana (`5h`, `week`...), un medidor de 10 celdas, el porcentaje usado y cuándo se reinicia. Un perfil sin datos muestra `no usage seen yet`. Se cierra con `Esc`, `Enter`, `Ctrl+C` o un clic en `esc close`. Sin la TUI se imprime el mismo cuadro como texto plano.

Solo muestra el uso que ya se vio: cada vez que la respuesta de Anthropic o de Codex de la cuenta activa informa sus límites, los números (porcentaje usado, etiqueta de la ventana, hora de reinicio y cuándo se vieron) se guardan en la carpeta de ese perfil como `usage.json`. No hace ninguna petición propia y nunca lee ni guarda un token ni los encabezados, así que el uso llega solo mientras esa cuenta es la activa, y un perfil que no ha usado desde entonces muestra `no usage seen yet` o los últimos números que vio. Borrar un perfil los borra y renombrarlo los mueve. El panel propio de Gentle Shell, `/gentle:usage`, no cambia en nada: este cuadro es una superposición aparte y el uso nativo queda como está.

- `/gentle:accounts usage`: abre la superposición.
- `/gentle:accounts usage off`: desactiva el cuadro y muestra `Account usage box disabled. The native Gentle Shell usage is unchanged.` Mientras está desactivado no se captura nada, y el menú oculta la pista y la tecla `g usage`.
- `/gentle:accounts usage on`: lo activa y muestra `Account usage box enabled.`
- Estando desactivado, `/gentle:accounts usage` muestra `Account usage box is disabled. Enable it with /gentle:accounts usage on.` (advertencia).
- Cualquier otro argumento: `Usage: /gentle:accounts usage [on|off]` (advertencia). Nada cambia.
- No se puede escribir el archivo de configuración: `Could not save the account usage setting (<code>).` (error). Nada cambia.

La opción es la clave `usageBox` de `profiles/settings.json` (vea [How it works](how-it-works.md)); está activada de forma predeterminada.

### `/gentle:accounts help`

`help` y `--help` muestran el texto de uso:

```
/gentle:accounts                 open the accounts menu (picker without the TUI)
/gentle:accounts menu            open the accounts menu
/gentle:accounts <name>          switch to <name>
/gentle:accounts list            list profiles (* marks the active one)
/gentle:accounts current         show the active profile
/gentle:accounts create <name>   create an empty profile
/gentle:accounts delete <name>   delete a profile (asks for confirmation)
/gentle:accounts rename <old> <new>  rename a profile (its logins move with it)
/gentle:accounts login claude    show the command that logs the active profile into Claude Code
/gentle:accounts session [<name>|last]  show, set or clear the profile new sessions start on (alias: startup)
/gentle:accounts email [show|hide]      show or set whether the status bar shows the full email
/gentle:accounts usage [on|off]         open the per-account usage box, or turn it on or off
```

### Hooks de la extensión

Además del comando, la extensión registra:

- **Inicio de sesión**: crea `default` si no hay un perfil activo; si lo hay, define `CLAUDE_CONFIG_DIR` para el perfil activo salvo que el entorno ya lo defina; luego, si hay un perfil de sesión definido y no es el activo, cambia a él y muestra `Started on profile "<name>" (session profile).` (nunca en una sesión iniciada por el launcher); inicia un temporizador de 60 s para actualizar el estado y lo muestra. Si no puede leer un archivo de credenciales muestra `gentle-accounts: <message>` (error) y continúa.
- **Respuesta del proveedor**: mientras el cuadro de uso está activado, guarda los límites que informó la respuesta bajo el perfil activo (vea `/gentle:accounts usage`).
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
| `gentle-accounts rename <old> <new>` | renombra un perfil | 0, o 1 si hay error |
| `gentle-accounts login <name>` | ejecuta `claude auth login` | código de salida de `claude`, o 1 si hay error |
| `gentle-accounts session [<name>\|last]` | muestra, define o borra el perfil de sesión | 0, o 1 si hay error |
| `gentle-accounts email [show\|hide]` | muestra o define la visualización del correo | 0, o 1 si hay error de uso |
| `gentle-accounts usage [on\|off]` | muestra o define el cuadro de uso de las cuentas | 0, o 1 si hay error de uso |
| `gentle-accounts <name> [args...]` | inicia `gentle-shell` | código de salida de `gentle-shell`, o 1 si hay error |

Texto de uso:

```
Usage:
  gentle-accounts <name> [gentle-shell args...]   start gentle-shell with profile <name>
  gentle-accounts list                            list profiles (* marks the active one)
  gentle-accounts current                         print the active profile
  gentle-accounts create <name>                   create an empty profile
  gentle-accounts rename <old> <new>              rename a profile (its logins move with it)
  gentle-accounts login <name>                    run `claude auth login` for that profile's Claude dir
  gentle-accounts session [<name>|last]           show, set or clear the profile new sessions start on (alias: startup)
  gentle-accounts email [show|hide]               show or set whether the status bar shows the full email
  gentle-accounts usage [on|off]                  show or set the per-account usage box of the accounts overlay
  gentle-accounts --help                          show this help
```

### `gentle-accounts list`

Imprime los perfiles en orden, con `* ` delante del activo. Sin perfiles: `No profiles. Create one with: gentle-accounts create <name>`.

### `gentle-accounts current`

Imprime el nombre del perfil activo, o `No active profile.`

### `gentle-accounts create <name>`

Crea un perfil vacío e imprime `Created profile "<name>".`. Con un nombre inválido o existente imprime el error (`Invalid profile name ...`, el mensaje de nombre reservado o `Profile "<name>" already exists.`) en stderr y termina con 1. Sin nombre imprime el uso en stderr y termina con 1.

### `gentle-accounts rename <old> <new>`

Igual que `/gentle:accounts rename`, con los mismos mensajes: el de éxito por stdout con código de salida 0, cada rechazo y el texto de uso por stderr con código de salida 1. No toca otras sesiones en marcha.

### `gentle-accounts login <name>`

Ejecuta `claude auth login` conectado a la terminal, con `CLAUDE_CONFIG_DIR` apuntando a la carpeta de Claude del perfil, o eliminado para un perfil en la carpeta predeterminada de Claude Code. No cambia de perfil. Sin nombre imprime el uso; para un perfil inexistente imprime `Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`; ambos terminan con 1. Si no puede iniciar `claude` imprime `Cannot run claude: <error>` y termina con 1.

### `gentle-accounts session [<name>|last]`

Igual que `/gentle:accounts session`, con los mismos mensajes: sin argumento imprime el perfil de sesión, `last` lo borra y un nombre lo define. Los mensajes van a stdout con código 0; un nombre inválido (`Invalid profile name ...`) o un perfil inexistente (`Profile "<name>" does not exist.`) van a stderr con código 1.

```sh
gentle-accounts session work   # new sessions start on "work"
gentle-accounts session        # show it
gentle-accounts session last   # back to the last used profile
```

### `gentle-accounts email [show|hide]`

Igual que `/gentle:accounts email`, con los mismos mensajes, en stdout con código 0. Cualquier otro argumento, o palabras extra después del modo, imprime `Usage: gentle-accounts email [show|hide]` en stderr y termina con código 1; si el archivo de configuración no se puede escribir imprime `Could not save the email display setting (<code>).` en stderr y termina con código 1. Una sesión abierta toma el cambio en su siguiente actualización del estado (después de un turno del agente, cada 60 segundos o con `/gentle:accounts current`).

```sh
gentle-accounts email show   # full email in the status bar
gentle-accounts email        # show the current value
gentle-accounts email hide   # back to hiding the email
```

### `gentle-accounts usage [on|off]`

Igual que `/gentle:accounts usage on` y `off`, con los mismos mensajes, en stdout con código 0. Sin argumento imprime `Account usage box: enabled` o `Account usage box: disabled`. Cualquier otro argumento imprime `Usage: gentle-accounts usage [on|off]` en stderr y termina con código 1; si el archivo de configuración no se puede escribir imprime `Could not save the account usage setting (<code>).` en stderr y termina con código 1.

### `gentle-accounts <name> [args...]`

Inicia `gentle-shell` en `<name>` dentro de una carpeta del agente privada para esa sesión, sin cambiar el perfil activo global: la sesión recibe su propio `auth.json`, un enlace al archivo propio del perfil en macOS y Linux y una copia privada en Windows o si el enlace falla, el `CLAUDE_CONFIG_DIR` del perfil (eliminado para `default`) y `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>`. Los argumentos restantes se pasan a `gentle-shell`. Al terminar, la carpeta privada se elimina; una copia privada se fusiona antes en el perfil, un enlace no necesita nada. Consulte [Cómo funciona](how-it-works.md). Primero crea `default` si no hay un perfil activo. En Windows `gentle-shell` y `claude` se inician a través de la shell para que se resuelvan los shims `.cmd`.

- Perfil inexistente: `Profile "<name>" does not exist. Create it with: gentle-accounts create <name>`, código 1.
- `--home`, `--link` o `--isolated` en los argumentos: `gentle-accounts manages the agent home; do not pass --home, --link or --isolated.`, código 1.
- Archivo de credenciales ilegible: el mensaje de error, código 1, nada cambia.
- `settings.json` compartido inválido: `gentle-accounts: cannot read <path>: <message>`, código 1, no se crea nada.
- Carpeta temporal insegura (POSIX): `gentle-accounts: refusing to use <path>: <reason>`, código 1.
- No se puede iniciar `gentle-shell`: `Cannot run gentle-shell: <error>`, código 1.

```sh
gentle-accounts work                  # open Gentle Shell as "work"
gentle-accounts login work            # log "work" into Claude
```
