[English](../en/troubleshooting.md) | Español

# Solución de problemas

Qué encontrará aquí: síntomas conocidos, su causa y la solución. Cada fila se basa en el código fuente o en evidencia medida; las filas marcadas "no verificado" no se pudieron comprobar en un sistema real.

## Síntomas

| Síntoma | Causa | Solución |
| --- | --- | --- |
| La barra de estado muestra `not logged in` justo después de iniciar sesión | El estado se actualiza al iniciar, después de un cambio, con `/gentle:accounts current`, después de cada turno del agente y cada 60 segundos; un inicio de sesión hecho en otra terminal se ve en la siguiente actualización. | Ejecute `/gentle:accounts current`. Si sigue mostrando `not logged in`, compruebe que el comando de inicio de sesión usó la carpeta de Claude del perfil que muestra `/gentle:accounts current`, o ejecute `gentle-accounts login <profile>`. |
| En macOS el inicio de sesión de `default` parece cerrado | Se definió `CLAUDE_CONFIG_DIR` como `~/.claude`; la entrada del llavero depende de esa variable, así que Claude Code ya no encuentra la sesión. | No defina `CLAUDE_CONFIG_DIR=~/.claude` en su shell. Déjela sin definir para `default`; consulte [Cómo funciona](how-it-works.md). |
| Existen `/profile` y `/gentle:accounts` a la vez | El paquete anterior `gentle-profiles` sigue instalado junto al nuevo. | Quite la línea `git:github.com/fcireza/gentle-profiles` de `packages` en `settings.json` y reinicie. |
| `Cannot parse <path>: <reason>` | Ese `auth.json` (el activo de pi o el de un perfil) no es JSON válido o no es un objeto JSON. El cambio leyó todos los archivos primero, así que nada cambió. | Corrija el JSON de ese archivo o restáurelo desde una copia de seguridad y vuelva a cambiar. Al iniciar la sesión el mismo error aparece como `gentle-accounts: Cannot parse ...`. |
| `Wait for the current turn to finish before switching profiles.` | El agente está ocupado; solo se puede cambiar cuando está inactivo. | Espere a que termine el turno y vuelva a ejecutar el comando. |
| `gentle-accounts: command not found` (o el equivalente de PowerShell) | Instalar desde git no agrega el launcher al `PATH`. | Agregue el alias o la función de PowerShell de [Instalación](install.md), o ejecute directamente `node <clone>/bin/gentle-accounts.mjs`. |
| `gentle-accounts needs Node 22.18 or newer (found <version>).` | El launcher ejecuta el código TypeScript con la eliminación de tipos integrada de Node. | Instale Node 22.18 o posterior y asegúrese de que el `node` del `PATH` sea esa versión. |
| `Cannot run gentle-shell: <error>` | `gentle-shell` no está en el `PATH` de la terminal donde ejecutó `gentle-accounts <name>`. El cambio de perfil ya se hizo. | Instale Gentle Shell o agréguelo al `PATH`. Con pi sin Gentle Shell, use `/gentle:accounts <name>` dentro de pi. En Windows el launcher pasa por la shell, así que puede aparecer el error propio de la shell (no verificado). |
| `Cannot run claude: <error>` | La CLI `claude` no está en el `PATH`. | Instale Claude Code y compruebe `claude --version` en la misma terminal. |
| En Windows el comando de inicio de sesión impreso falla con una ruta poco común | El comando de Windows pone la carpeta entre comillas dobles, `$env:CLAUDE_CONFIG_DIR="<dir>"`, sin escaparla; una ruta con `"` o `$` necesitaría comillas manuales (no verificado en Windows). | Ajuste las comillas a mano, o use `gentle-accounts login <profile>`, que pasa la variable sin una línea de comandos de shell. |
| En Windows no se encuentra `gentle-shell` o `claude` instalados con npm | npm instala shims `.cmd` en Windows. | El launcher ya los ejecuta a través de la shell por ese motivo. Si aun así falla, compruebe que `where.exe gentle-shell` los encuentra (no verificado en un Windows real; solo cubierto por la matriz de CI). |
| Un perfil de Codex o Anthropic dejó de funcionar después de usar el mismo inicio de sesión en otro lado | Los tokens de actualización OAuth rotan; cuando otra herramienta renueva el mismo inicio de sesión, la copia guardada en el perfil puede quedar vencida. | Cambie a ese perfil e inicie sesión de nuevo con `/login`. |
| La barra de estado no aparece y `/gentle:accounts` no existe | La extensión no está cargada: el paquete no está en el `settings.json` de esa carpeta del agente, o Gentle Shell o pi no se reiniciaron. | Revise que la lista `packages` de `settings.json` incluya `git:github.com/fcireza/gentle-accounts` y reinicie. |
| El launcher muestra perfiles distintos a los de Gentle Shell o pi | El launcher lee `PI_CODING_AGENT_DIR`, luego `GENTLE_SHELL_HOME`, luego `~/.gentle-shell/agent`; pi sin Gentle Shell usa `~/.pi/agent`. | Defina `PI_CODING_AGENT_DIR` con la carpeta del agente que usa antes de ejecutar el launcher. |

## Si el problema continúa

Abra un issue en [github.com/fcireza/gentle-accounts/issues](https://github.com/fcireza/gentle-accounts/issues) con el mensaje exacto. Nunca pegue tokens ni el contenido de `auth.json`.
