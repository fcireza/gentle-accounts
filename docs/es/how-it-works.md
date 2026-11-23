[English](../en/how-it-works.md) | Español

# Cómo funciona

Qué encontrará aquí: dónde viven los perfiles en disco, qué ocurre paso a paso al cambiar de perfil, por qué `CLAUDE_CONFIG_DIR` queda sin definir para `default`, cómo la barra de estado detecta la cuenta, y las reglas de seguridad.

![Carpetas de perfiles e intercambio de credenciales](../../assets/how-it-works.svg)

## Estructura en disco

Todo vive dentro de la carpeta del agente de pi (`~/.gentle-shell/agent` para Gentle Shell, `~/.pi/agent` para pi):

```
profiles/
  current             the active profile name
  startup             optional: the profile new sessions start on
  work/
    claude/           this profile's Claude Code login
    auth.json         this profile's account (oauth) credentials
  default/
    claude-default    marker: use Claude Code's default folder, CLAUDE_CONFIG_DIR unset
    auth.json
```

- `profiles/current` guarda el nombre del perfil activo. Un nombre que no corresponde a un perfil existente equivale a no tener perfil activo.
- `profiles/startup` guarda el nombre del perfil de sesión; lo escribe `session <name>` y lo borra `session last`. Si no existe, o nombra un perfil que ya no existe, las sesiones nuevas empiezan en el último perfil usado.
- `<name>/claude/` es el `CLAUDE_CONFIG_DIR` del perfil, la carpeta donde Claude Code guarda el inicio de sesión de ese perfil. pi-claude-bridge lee `CLAUDE_CONFIG_DIR` del entorno del proceso.
- `<name>/auth.json` guarda las entradas cubiertas del perfil, con el formato del `auth.json` de pi. Cubiertas son `openai-codex`, `anthropic` y cualquier otro proveedor cuya entrada sea `"type": "oauth"`; los proveedores con clave de API (como `google`) quedan globales y nunca se mueven. Una carpeta sin `auth.json` no es un perfil.
- `claude-default` es un marcador vacío: el perfil usa la carpeta predeterminada de Claude Code y `CLAUDE_CONFIG_DIR` debe quedar sin definir.
- `claude-dir` guarda en cambio una carpeta explícita. Se escribe cuando `default` se crea mientras usted tenía `CLAUDE_CONFIG_DIR` definido. Un `claude-dir` antiguo que apunta a `~/.claude` se trata igual que el marcador `claude-default`.

Todas las rutas se construyen con las funciones de `path` de Node, así que la misma estructura funciona en Linux, macOS y Windows.

## El archivo de credenciales enlazado

En macOS y Linux el archivo de credenciales que lee pi (`auth.json` en la carpeta del agente) es un enlace al archivo propio del perfil actual, `profiles/<name>/auth.json`:

- Cambiar de perfil reapunta el enlace. No se copian credenciales OAuth en ningún sentido, y un token que pi rota se guarda directamente en el archivo del perfil.
- La primera vez que la extensión arranca fuera de una sesión del launcher, un archivo regular existente se migra una sola vez: su contenido pasa al archivo del perfil actual (gana la entrada OAuth más reciente de cada proveedor) y el enlace lo reemplaza. Muestra `Each profile now keeps its own logins: the credentials file is linked to profile "<name>".`
- Las claves de API (proveedores que no son OAuth, como `google`) siguen siendo globales: en un cambio de perfil se llevan al perfil al que cambia. Las activas ganan en un conflicto, una clave que solo tiene ese perfil se conserva y un cambio nunca borra una clave.
- Un `/login` hecho directamente en pi, fuera del menú de cuentas, se guarda en el perfil ACTUAL y reemplaza allí el token de ese proveedor. Un login que pertenece a otra cuenta debe hacerse desde el menú de cuentas (cambia primero al perfil) o en una sesión iniciada con `gentle-accounts <profile>`.
- Si no se puede crear el enlace, o en Windows, nada cambia: se mantiene el modelo de copias, donde las credenciales se guardan en el perfil saliente y se cargan desde el entrante, como describe el resto de esta página.

## El perfil de sesión al iniciar la sesión

Al iniciar la sesión, la extensión primero crea `default` si no hay un perfil activo, o aplica el `CLAUDE_CONFIG_DIR` del perfil activo. Luego, si hay un perfil de sesión definido y no es el activo, cambia a él con el mismo cambio seguro que `/gentle:accounts <name>`: lee todos los archivos antes de escribir alguno, guarda las credenciales cubiertas del perfil que deja y define o elimina `CLAUDE_CONFIG_DIR` (eliminado para `default`). Después muestra `Started on profile "<name>" (session profile).`. Si el perfil de sesión ya es el activo, nada cambia. Si no puede leer un archivo, muestra `gentle-accounts: <message>` (error), nada cambia y la sesión sigue funcionando con el último perfil usado.

El cambio al perfil de sesión se omite si `GENTLE_ACCOUNTS_LAUNCH_PROFILE` está definida (no vacía): el launcher la define al iniciar gentle-shell con `gentle-accounts <name>`, que ya cambió a `<name>`. Si `profiles/startup` nombra un perfil que ya no existe, al iniciar la sesión se muestra `Session profile "<name>" does not exist; starting on the last used profile.` (advertencia) y nada cambia. El cambio al perfil de sesión solo ocurre cuando pi arranca. No se ejecuta en `/new`, `/resume`, `/fork` ni `/reload`, así que un perfil al que cambió a mano sigue activo.

### Una cuenta distinta en cada sesión

Una sesión iniciada sin el launcher usa el perfil global: `profiles/current` y el único `auth.json` que comparten todas esas sesiones. Cambiar de perfil en una de ellas cambia las credenciales cubiertas (Codex, Anthropic y cualquier otro inicio de sesión OAuth) que leen las demás: en macOS y Linux el enlace compartido pasa a apuntar al archivo de otro perfil.

Una sesión iniciada con `gentle-accounts <name>` recibe en cambio su propia carpeta del agente privada, así que varios proyectos pueden funcionar al mismo tiempo con una cuenta distinta cada uno:

1. El launcher crea `<tmp>/gentle-accounts-<uid>/<uuid>` (`<tmp>/gentle-accounts/<uuid>` en Windows) con permisos `0700`. En POSIX rechaza una carpeta base que sea un enlace simbólico, que pertenezca a otro usuario o que el grupo u otros puedan escribir: `gentle-accounts: refusing to use <path>: <reason>`.
2. Cada entrada de la carpeta del agente compartida se enlaza dentro de ella, excepto `auth.json`, `settings.json`, `auth.json.*`, `*.lock` y los nombres que empiezan con `.gentle-` (en Windows las carpetas pasan a ser junctions y los archivos usan un enlace duro o, si no se puede, una copia).
3. La carpeta recibe su propio `auth.json`: en macOS y Linux un enlace al archivo propio de ese perfil, así que dos sesiones en el mismo perfil comparten un solo archivo y ven el token rotado por la otra; en Windows, o si el enlace falla, una copia privada (`0600`) de las credenciales del perfil. También recibe su propio `settings.json` (una copia del compartido con las rutas relativas de paquetes convertidas en absolutas) y un marcador `.gentle-accounts-session.json`.
4. Ejecuta `gentle-shell --home <home>` con `GENTLE_SHELL_NO_AUTO_SETUP=1`, `GENTLE_ACCOUNTS_LAUNCH_PROFILE=<name>` y el `CLAUDE_CONFIG_DIR` del perfil.
5. Cuando gentle-shell termina (con cualquier código, con Ctrl+C o con una señal de cierre), el launcher elimina la carpeta sin seguir enlaces. Con un enlace no hay nada que copiar de vuelta; una copia privada se fusiona antes, con sus entradas cubiertas pasando al perfil. El siguiente inicio también limpia las carpetas cuyos procesos del launcher y de gentle-shell ya no existen.

Dentro de esa sesión, la extensión lee los perfiles de la carpeta del agente compartida, pero las credenciales vivas son el `auth.json` de la carpeta privada y el perfil actual de la sesión se guarda en ella (`.gentle-accounts-current`), nunca en `profiles/current`. Un cambio de perfil dentro de la sesión solo afecta a esa sesión. El perfil de sesión no se aplica allí; el menú muestra el modo `session home`.

Al fusionar credenciales (una copia privada de vuelta, una migración o un guardado en un cambio de perfil con el modelo de copias), gana el inicio de sesión más reciente de cada proveedor: se conserva la entrada OAuth que vence más tarde, así que una sesión que termina después nunca sobrescribe un token que otra sesión renovó.

Límite conocido: los inicios de sesión OAuth de Codex y Anthropic usan refresh tokens rotativos. Usar la MISMA cuenta en dos sesiones abiertas a la vez puede hacer que una invalide el token que tiene la otra, y esa sesión tendrá que iniciar sesión de nuevo. Es preferible usar una cuenta (perfil) distinta en cada sesión.

Límite conocido: una construcción de sesión que agrega claves globales aún puede competir con una rotación de token hecha por otra sesión abierta en el mismo perfil, porque no hay bloqueo.

## El cambio de perfil, paso a paso

`/gentle:accounts <name>` (y el menú) siguen estos pasos. En una sesión iniciada por el launcher, "el `auth.json` vivo" es el archivo propio de la carpeta privada y el perfil actual se guarda en ella:

1. Comprobar que el destino existe y que su `auth.json` se puede leer. Si no, detenerse antes de crear nada.
2. Si no hay un perfil activo, crear primero `default` con los inicios de sesión actuales (consulte [Flujo de trabajo](workflow.md)).
3. Si el destino ya está activo, detenerse con `Already on profile "<name>".`
4. Leer todos los archivos antes de escribir alguno: el `auth.json` activo de pi, el `auth.json` del destino y el `auth.json` del perfil saliente. Un archivo corrupto detiene el cambio con `Cannot parse <path>: <reason>` y no se escribe nada.
5. Archivo enlazado (macOS y Linux): apuntar el enlace al archivo propio del destino. No se copian credenciales OAuth en ningún sentido. Modelo de copias (Windows, o no se pudo crear el enlace): guardar el saliente, copiando las entradas cubiertas activas al `auth.json` del perfil saliente (una entrada que falta en el archivo activo se elimina de la copia guardada).
6. Archivo enlazado: llevar las claves de API (entradas que no son OAuth) al archivo del destino; las activas ganan en un conflicto, una clave que solo tiene el destino se conserva y nunca se borra una clave. Modelo de copias: cargar el entrante, copiando las entradas cubiertas del destino al `auth.json` activo de pi y eliminando las que el destino no tiene; las entradas con clave de API de otros proveedores quedan como estaban.
7. Definir `CLAUDE_CONFIG_DIR` con la carpeta de Claude del destino, o borrar la variable para un perfil en la carpeta predeterminada de Claude Code (se borra; nunca se le asigna el texto `undefined`).
8. Escribir el nombre del destino en `profiles/current`.

Cada `auth.json` se escribe en un archivo temporal a su lado y luego se renombra sobre el original, así un lector nunca ve un archivo a medio escribir. Una escritura en el archivo de credenciales enlazado pasa por el enlace al archivo al que apunta; nunca reemplaza el enlace. pi recarga `auth.json` cuando cambia. Los archivos se crean con permisos `0600` y las carpetas de perfil con `0700`, en los sistemas que los respetan.

En la extensión, el cambio además recarga el registro de modelos de pi y actualiza la barra de estado. El launcher no cambia de perfil: crea una carpeta privada para la sesión (consulte la sección anterior).

Al iniciar la sesión, la extensión también define `CLAUDE_CONFIG_DIR` para el perfil activo, salvo que el entorno ya lo defina, para que el bridge use el inicio de sesión correcto aunque Gentle Shell se inicie sin el launcher.

## Renombrar un perfil

1. Primero van todos los rechazos, antes de tocar nada: el perfil anterior existe, los nombres difieren, el nombre nuevo es válido y no está reservado, y `profiles/<new>` no existe (una carpeta sobrante cuenta).
2. Las carpetas de sesión cuyo launcher ya no existe se terminan, así que sus credenciales se guardan con el nombre anterior. Después, una sesión del launcher que sigue en marcha sobre el perfil impide el cambio.
3. `profiles/<old>/` pasa a `profiles/<new>/` con un solo renombrado de carpeta, reintentado brevemente ante errores de bloqueo en Windows. Las credenciales nunca se copian.
4. Se reescriben los archivos que nombraban al perfil anterior: `profiles/current` (y el archivo de perfil actual de la propia sesión), `profiles/startup`, y un `claude-dir` que apuntaba dentro de la carpeta anterior. Uno externo no se toca.
5. `CLAUDE_CONFIG_DIR` de este proceso se define con la carpeta de Claude nueva solo cuando contenía la anterior, así que un valor que usted definió se respeta.

Si falla un paso después del movimiento, la carpeta y los archivos ya reescritos vuelven a su lugar y se muestra el error original. Las sesiones que ya estaban en marcha sobre el perfil conservan el `CLAUDE_CONFIG_DIR` anterior hasta que cambien de perfil o se reinicien, por eso el mensaje de éxito lo avisa.

## Por qué `CLAUDE_CONFIG_DIR` queda sin definir para `default`

En macOS, Claude Code guarda el inicio de sesión en el llavero, y la entrada depende de la carpeta configurada. Por eso definir `CLAUDE_CONFIG_DIR` con la ruta predeterminada no equivale a dejarlo sin definir. Esto se midió en macOS con `claude auth status`:

| Entorno | Resultado |
| --- | --- |
| `CLAUDE_CONFIG_DIR` sin definir | sesión iniciada, con el correo |
| `CLAUDE_CONFIG_DIR=$HOME/.claude` | sin sesión |
| una carpeta propia vacía | sin sesión |

Así que `default` recibe el marcador `claude-default` y la variable se elimina mientras está activo, en la extensión y en el entorno del proceso hijo del launcher. `/gentle:accounts current` muestra `CLAUDE_CONFIG_DIR=(unset: Claude Code default)`, y el comando de inicio de sesión para `default` es simplemente `claude auth login`. La misma medición no se repitió en Linux ni en Windows (no verificado).

## Logins detectados

El menú busca logins que ningún perfil tiene y los ofrece con `i`:

- Una cuenta de Claude en `~/.claude` que ningún perfil usa. Adoptarla crea un perfil con el directorio por defecto de Claude Code; no se copia ni se mueve nada. Esto sigue funcionando con el archivo enlazado.
- Una cuenta de Codex en el `auth.json` en vivo cuyo `accountId` difiere del que está en la copia guardada del perfil activo y no está en ningún otro perfil. Adoptarla copia esa entrada a un perfil nuevo y lo deja como actual. El perfil anterior conserva su cuenta. Los logins detectados ya no se pueden adoptar mientras el archivo de credenciales está enlazado: un `/login` hecho directamente en pi se guarda en el perfil actual, así que el menú lo rechaza con `Cannot adopt a live login while the credentials file is linked to a profile: a login made there is saved in the current profile.` Inicie la otra cuenta desde el menú de cuentas o en una sesión iniciada con `gentle-accounts <profile>`.

Las entradas de Anthropic no traen un id de cuenta, así que un login nuevo de Anthropic no se distingue de un refresco de token y no se detecta. La detección es de solo lectura, corre solo fuera de las sesiones del launcher y un `auth.json` ilegible no detecta nada.

## Cerrar la sesión de un proveedor

`x` en una fila de proveedor con sesión borra la entrada de ese proveedor del `auth.json` del perfil, y también del `auth.json` activo cuando el perfil es el actual. Los demás perfiles y las claves de API no se tocan, y se leen todos los archivos antes de escribir ninguno, así que un archivo corrupto no cambia nada. El token solo se olvida en esta máquina; no se revoca en el proveedor.

La sesión de Claude vive en su propio directorio de configuración, que puede ser el predeterminado compartido con otras herramientas, así que el menú pide confirmación (y avisa si la carpeta es compartida) y ejecuta `claude auth logout` con el `CLAUDE_CONFIG_DIR` del perfil. Con la visualización de email activada, Codex y los demás proveedores OAuth también muestran el email de la cuenta cuando la credencial lo trae (se lee localmente del token guardado; nunca se verifica).

## La barra de estado

La extensión muestra la cuenta con `setStatus` de pi, bajo la clave `gentle-accounts`. Gentle Shell la muestra en su barra de estado y en la barra lateral.

- Con sesión: `👤 gentle-accounts: <profile>`, por ejemplo `👤 gentle-accounts: work`. De forma predeterminada el correo está oculto y no se muestra en absoluto; con `/gentle:accounts email show` la dirección completa aparece después del perfil, por ejemplo `👤 gentle-accounts: work · maria.lopez@company.com`.
- Sin sesión: `🔒 gentle-accounts: <profile> · not logged in`, por ejemplo `🔒 gentle-accounts: work · not logged in`.

El ícono distingue los dos estados de un vistazo: `👤` indica que se detectó un inicio de sesión de Claude para el perfil y `🔒` que no se detectó.
- Sin perfil activo: el estado se borra.

Visualización del correo: mientras está oculto no aparece ningún correo en ninguna parte, ni siquiera enmascarado. Con `showEmail` en `true` la barra de estado muestra la dirección completa y el menú la muestra enmascarada después de tres caracteres (`mar****@company.com`). El texto de la barra de estado usa los colores del tema: `muted` para la etiqueta, `accent` para el perfil, `text` para el correo y `warning` para `not logged in`.

Detección:

1. Ejecutar `claude auth status` con el `CLAUDE_CONFIG_DIR` del perfil (o sin él para `default`), con argumentos fijos y un límite de 5 segundos. Su respuesta JSON da `loggedIn` y `email`.
2. Si falta la CLI `claude`, se agota el tiempo o no imprime JSON, leer `oauthAccount.emailAddress` de `.claude.json` en la carpeta de Claude del perfil (y de `~/.claude.json` para la carpeta predeterminada).

Actualización: al iniciar la sesión, después de un cambio, con `/gentle:accounts current`, después de cada turno del agente y cada 60 segundos. Una actualización que ya está en curso para el mismo perfil se omite, y el resultado de un perfil que ya no está activo se descarta. Un inicio de sesión hecho en otra terminal aparece solo en menos de un minuto.

Opción de visualización del correo: `/gentle:accounts email [show|hide]` y `gentle-accounts email [show|hide]` la guardan en `profiles/settings.json` con la clave `showEmail` (valor predeterminado `false`). Solo un `true` literal muestra el correo completo. Un archivo inexistente, vacío o inválido significa oculto y nunca se reescribe al leerlo. La escritura conserva cualquier otra clave y usa la misma escritura atómica que los archivos de credenciales (archivo temporal y luego renombrado) con permisos `0600`. El archivo es global para la carpeta del agente y se lee en cada actualización del estado.

El correo completo solo se escribe en la barra de estado, y solo cuando la opción está en mostrar: ninguna notificación, salida de comando, registro ni imagen lo contiene, en ningún modo.

Codex no muestra correo, porque pi solo guarda un identificador de cuenta opaco (según el README existente, no verificado contra el código de pi).

## Seguridad

- Los tokens nunca se imprimen: el estado y las notificaciones solo usan el nombre del perfil; el correo completo aparece solo en la barra de estado, y solo después de `/gentle:accounts email show`. Si está visible, cualquier persona que vea su pantalla puede leerlo.
- `profiles/settings.json` se escribe con permisos `0600`.
- Los archivos de credenciales, `profiles/current` y `profiles/startup` se escriben con permisos `0600`.
- Nada sale de su equipo: el paquete solo lee y escribe archivos locales y ejecuta la CLI `claude` local. No hace solicitudes de red propias; `claude auth login` y el `/login` de pi hablan con sus proveedores como siempre.
- Los comandos se ejecutan con argumentos fijos; en Windows pasan por la shell solo para resolver los shims `.cmd`.

## Lo que no se soporta a propósito

- El login desde la extensión usa el flujo OAuth propio del proveedor, así que los proveedores sin login OAuth (y la lista de `/login`) siguen en pi.
- Agregar entradas al menú de comandos de Gentle Shell: es una lista fija que las extensiones no pueden ampliar, así que los puntos de entrada son `/gentle:accounts` (y su menú) y la barra de estado.
- Cambiar de perfil durante un turno del agente.
- Borrar el perfil activo, o borrar desde el launcher.
- Renombrar un perfil que usa una sesión en marcha del launcher: cierre la sesión primero.
- Intercambiar proveedores con clave de API distintos de `openai-codex` y `anthropic` (los proveedores OAuth y Claude mediante `CLAUDE_CONFIG_DIR` sí se intercambian).
- El antiguo comando `/profile`: se renombró a `/gentle:accounts`.
