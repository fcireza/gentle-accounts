[English](../en/antigravity.md) | Español

# Antigravity: plan de varias cuentas

Qué encontrará aquí: un plan, no una funcionalidad. Nada de lo descrito está implementado. Los datos que no se pudieron comprobar están marcados como "por confirmar"; no se consultó ninguna fuente web para escribir esta página.

## Objetivo

Guardar varias cuentas de Antigravity (Google) en perfiles de gentle-accounts, como hoy Claude, Codex y Anthropic: cada perfil con su propio inicio de sesión, cambio con `/gentle:accounts <name>` y una cuenta distinta por sesión con `gentle-accounts <name>`.

## Qué existe hoy

- pi 1.5.x no incluye un proveedor de Antigravity ni de Gemini CLI. Sus proveedores `google` y `google-vertex` usan claves de API, no inicios de sesión de cuenta. Antes de que pi pueda usar una cuenta de Antigravity tiene que existir un proveedor OAuth propio para pi.
- gentle-accounts solo intercambia las entradas de `auth.json` listadas en `COVERED_PROVIDERS` (`src/auth-sync.ts`): `openai-codex` y `anthropic`.
- Claude se cubre de otra forma: cada perfil tiene su propio `CLAUDE_CONFIG_DIR`, que se define o elimina en cada proceso.

## Preguntas de investigación

1. ¿Dónde guardan Antigravity y la Gemini CLI sus credenciales en macOS, Linux y Windows (un archivo, el llavero de macOS, el almacén de credenciales de Windows)? Por confirmar.
2. ¿Existe una variable de entorno que cambie esa carpeta, como `CLAUDE_CONFIG_DIR` para Claude Code? Por confirmar.
3. ¿Cómo se renuevan los tokens: los refresh tokens rotan, y una renovación en un proceso invalida la copia que tiene otro? Por confirmar.
4. ¿Los términos de uso permiten varias cuentas en un mismo equipo y cambiar entre ellas? Por confirmar.
5. ¿Un proveedor OAuth de pi para Antigravity guardaría su inicio de sesión en el `auth.json` de pi como `openai-codex`? Por confirmar (depende de cómo se escriba el proveedor).

## Opciones

| Opción | Cómo | Cuándo conviene |
| --- | --- | --- |
| A. Una carpeta de configuración por cuenta | Como Claude: cada perfil tiene una carpeta y el launcher define la variable que apunta la herramienta a ella. | Solo si la pregunta 2 encuentra esa variable. |
| B. Guardar y restaurar | Guardar el archivo de credenciales del perfil saliente y restaurar el del entrante en cada cambio, con las mismas escrituras atómicas y la misma regla del token más reciente que `auth.json`. | Si las credenciales están en un archivo común y no existe la variable. No sirve con un llavero. |
| C. Proveedor en el `auth.json` de pi | Cuando exista un proveedor OAuth de pi, su entrada vive en `auth.json` y gentle-accounts la intercambia como la de Codex. | Requiere primero el proveedor; después es la opción más simple. |

## Riesgos

- Refresh tokens rotativos: la misma cuenta en dos sesiones abiertas puede invalidar un token (ya ocurre con Codex y Anthropic).
- Si las credenciales están en un llavero (pregunta 1), la opción B es imposible y la opción A depende de cómo se nombra la entrada del llavero, como pasa con Claude en macOS.
- Los términos de uso (pregunta 4) podrían prohibir este uso.
- Un proveedor propio de pi depende de una interfaz que puede cambiar entre versiones de pi.

## Paso de preparación

Antes de cualquier código de Antigravity, dejar de fijar dos proveedores en el código: tratar como cubierto todo proveedor basado en cuenta guardado en `auth.json`, con una lista de exclusión configurable para los proveedores que solo usan clave de API. Así cualquier proveedor que se registre después (opción C) funciona sin cambios. Es una tarea aparte.

## Criterios de salida

El plan se convierte en tarea cuando:

1. Las preguntas 1 a 4 tienen respuestas respaldadas por evidencia (código fuente, documentación o una medición), cada una anotada en el documento de la funcionalidad.
2. Se elige una opción, con su motivo.
3. El paso de preparación está integrado y probado.
4. Para la opción C, existe un proveedor de Antigravity para pi y se probó a mano.

Volver al [índice de la documentación](README.md).
