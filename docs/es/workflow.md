[English](../en/workflow.md) | Español

# Flujo de trabajo

Qué encontrará aquí: escenarios completos desde el primer inicio hasta borrar un perfil, con los mensajes que verá.

![Barra de estado con el perfil activo y su cuenta enmascarada](../../assets/hero-status-bar.svg)

## 1. Primer inicio y el perfil `default`

Después de instalar, reinicie Gentle Shell o pi. Al iniciar la sesión, si todavía no hay un perfil activo, la extensión agrupa sus inicios de sesión actuales en un perfil llamado `default`:

- Las credenciales actuales de Codex y Anthropic del `auth.json` de pi se copian a `profiles/default/auth.json`.
- El inicio de sesión de Claude Code no se mueve ni se copia. `default` sigue usando la carpeta predeterminada de Claude Code, y `CLAUDE_CONFIG_DIR` queda **sin definir** mientras está activo. Consulte [Cómo funciona](how-it-works.md) para saber por qué.
- Si había definido `CLAUDE_CONFIG_DIR` por su cuenta, esa carpeta se registra (no se copia) y se conserva.

Compruébelo:

```
/gentle:accounts current
```

```
Active profile: default (CLAUDE_CONFIG_DIR=(unset: Claude Code default))
```

## 2. Una cuenta de Claude de trabajo y una personal

En este ejemplo `default` ya tiene la cuenta personal y se agrega `work`.

Cree el perfil:

```
/gentle:accounts create work
```

```
Created profile "work". Switch with /gentle:accounts work, then /login for Codex or Anthropic and /gentle:accounts login claude for Claude.
```

Cambie a ese perfil:

```
/gentle:accounts work
```

El perfil tiene una carpeta de Claude vacía, así que todavía no tiene sesión iniciada. Pida el comando de inicio de sesión:

```
/gentle:accounts login claude
```

![El comando de inicio de sesión resaltado en macOS, Linux y Windows](../../assets/workflow-login.svg)

En macOS o Linux el mensaje se ve así:

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

Copie el comando que sigue a `$ ` o `PS> ` y ejecútelo en otra terminal. Para `default` el comando es simplemente `claude auth login`, sin el prefijo `CLAUDE_CONFIG_DIR`.

Alternativa: si configuró el alias del launcher ([Instalación](install.md)), ejecute esto en una terminal. Corre `claude auth login` para la carpeta de Claude de ese perfil, conectado a la terminal:

```sh
gentle-accounts login work
```

Cuando termine el flujo del navegador, compruebe la cuenta:

```
/gentle:accounts current
```

La barra de estado muestra entonces `👤 gentle-accounts: work · mari****@company.com`.

### Por qué el inicio de sesión no se ejecuta dentro de la TUI

`claude auth login` es interactivo: abre un navegador y espera. La TUI de pi controla la terminal, así que un proceso hijo competiría con ella por la pantalla y el teclado. Por eso `/gentle:accounts login claude` solo imprime el comando, y `gentle-accounts login <profile>` del launcher es la forma soportada de ejecutarlo directamente.

## 3. Credenciales de Codex o Anthropic

Codex (`openai-codex`) y Anthropic (el proveedor nativo `anthropic` de pi) usan el `/login` normal de pi. Con un perfil activo, ejecute:

```
/login
```

pi escribe las credenciales en su `auth.json` activo. Se guardan en el `auth.json` del perfil activo la próxima vez que cambie a otro perfil (con `/gentle:accounts <name>` o con el launcher). Hasta entonces solo están en el `auth.json` de pi. Las credenciales de otros proveedores nunca se tocan.

## 4. Cambiar de un perfil a otro

![Listar perfiles y cambiar entre ellos](../../assets/workflow-switch.svg)

Liste los perfiles; `*` marca el activo:

```
/gentle:accounts list
```

```
* default
  work
```

Cambie por nombre, o ejecute `/gentle:accounts` sin argumentos para elegir de una lista:

```
/gentle:accounts default
```

```
Switched to profile "default". Claude Code dir: (unset: Claude Code default)
```

Cambiar al perfil que ya está activo solo indica `Already on profile "default".`. El cambio espera al agente: mientras hay un turno en curso aparece `Wait for the current turn to finish before switching profiles.`

Cómo leer la barra de estado: `👤 gentle-accounts: <profile> · <masked email>` cuando se detecta el inicio de sesión de Claude del perfil, `🔒 gentle-accounts: <profile> · not logged in` en caso contrario. El ícono muestra el estado de un vistazo: `👤` con sesión, `🔒` sin sesión. El correo aparece enmascarado, por ejemplo `mari****@company.com`. El estado se actualiza al iniciar, después de un cambio, con `/gentle:accounts current`, después de cada turno del agente y cada 60 segundos.

## 5. Iniciar una sesión en un perfil

Con el alias del launcher, inicie Gentle Shell directamente en un perfil. Los argumentos extra se pasan a `gentle-shell`:

```sh
gentle-accounts work
```

El launcher hace el mismo cambio que `/gentle:accounts work` (primero crea `default` si no hay un perfil activo) y luego inicia `gentle-shell` con `CLAUDE_CONFIG_DIR` definido para ese perfil, o eliminado para `default`.

## 6. Elegir el perfil con el que empiezan las sesiones nuevas

De forma predeterminada, una sesión nueva empieza en el último perfil usado. Para empezar siempre en `work`, defínalo como perfil de inicio:

```
/gentle:accounts startup work
```

```
Startup profile set to "work". New sessions start on it.
```

Reinicie Gentle Shell o pi. Si había otro perfil activo, la sesión cambia a `work` al iniciar y muestra `Started on profile "work" (startup profile).`. Para volver al último perfil usado:

```
/gentle:accounts startup last
```

```
Startup profile cleared. New sessions start on the last used profile.
```

El perfil de inicio es compartido por todas las sesiones de la misma carpeta del agente; consulte el límite conocido en [Cómo funciona](how-it-works.md).

## 7. Borrar un perfil

No se puede borrar el perfil activo ni el perfil de inicio, así que primero cambie a otro (o ejecute `startup last`):

```
/gentle:accounts default
/gentle:accounts delete work
```

Un diálogo de confirmación pregunta `Delete profile "work" and its Claude login and credentials? This cannot be undone.`. Al confirmar aparece `Deleted profile "work".`; al cancelar, `Delete cancelled.`. Se borra toda la carpeta del perfil, incluida su carpeta de inicio de sesión de Claude. El launcher no tiene comando para borrar.
