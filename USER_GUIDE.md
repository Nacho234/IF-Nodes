# IF Nodes — Guía de uso

Cómo usar el sistema, función por función. Para el estado técnico ver [HANDOFF.md](HANDOFF.md).

---

## Ingresar

Entrás con un email de la lista autorizada (`AUTHORIZED_EMAILS` del `.env`).
- **Con Google configurado:** botón "Continuar con Google".
- **En desarrollo:** "Ingreso de desarrollo" → escribís tu email autorizado → Ingresar.

El primer usuario que entra queda como **OWNER**; el resto como **DEVELOPER**.

---

## Clientes

Organizan los proyectos por cliente. **Clientes → Nuevo cliente**: nombre (obligatorio), rubro, contacto, estado (Prospecto / En desarrollo / Activo / Pausado / Finalizado / Archivado) y notas internas.

En el menú **⋯** de cada fila: **Editar**, **Archivar** (lo saca de la vista por defecto) o **Eliminar** (borra el cliente **y todos sus proyectos** en cascada — el diálogo te avisa cuántos).

---

## Proyectos

Cada proyecto es un bot o automatización. **Proyectos → Nuevo proyecto**: elegís cliente, nombre y tipo (Bot de WhatsApp, Chat web, Webhook, Programada, Integración, Agente de IA, Interna, Personalizado). Se crea con un **flujo principal** vacío y tres entornos (Development / Testing / Production).

La página del proyecto muestra estado, tipo, flujos, entornos y accesos a **Casos de prueba**, **Ejecuciones** y **Variables por entorno**. Desde ahí abrís el **constructor** o **eliminás** el proyecto (⋯ en la lista o botón en el detalle).

---

## Constructor (el corazón)

**Abrir constructor** dentro de un proyecto. Tres zonas: biblioteca de nodos (izquierda), lienzo (centro), configuración (derecha).

### Armar el flujo
- **Agregar nodo:** arrastrá desde la biblioteca al lienzo, o doble clic.
- **Conectar:** arrastrá desde el punto de salida de un nodo al de entrada de otro.
- **Configurar:** clic en un nodo → panel derecho. Los campos se generan según el nodo.
- **Atajos:** `⌘Z` deshacer · `⇧⌘Z` rehacer · `⌘C`/`⌘V` copiar/pegar · `⌘D` duplicar · `Supr` eliminar · `⌘S` guardar ya. **Guarda solo** con debounce.
- Botón de **nota** para dejar comentarios en el lienzo.

### Variables y expresiones
En cualquier campo que lo soporte (marcado con `{{ }}`) podés interpolar datos:
```
{{trigger.text}}              el texto del mensaje/entrada
{{trigger.name}} {{trigger.phone}}
{{nodes.<id>.output.<campo>}} salida de otro nodo
{{variables.<clave>}}         variables definidas por "Establecer variable"
{{environment.<CLAVE>}}       variables por entorno
```
Funciones: `uppercase() lowercase() trim() default() contains() length() number() string() json() formatDate() addDays() subtractDays()`.

### Probar
- **Ejecutar** (arriba a la derecha): corre el flujo con el payload de ejemplo del disparador; los nodos se iluminan (verde ok, rojo error) con su duración. Clic en un nodo para ver su entrada/salida.
- **Simulador:** chat de WhatsApp. Escribís como cliente, cada mensaje ejecuta el flujo y muestra la respuesta del bot. Ideal para bots conversacionales.
- **Validar:** revisa el grafo (disparador presente, nodos sueltos, ciclos, config incompleta) y lista los problemas.

### Guardar caso de prueba
Después de ejecutar, botón **Guardar caso**: crea un caso con esa entrada (ver "Casos de prueba").

---

## Nodos disponibles

**Disparadores:** Inicio manual · Webhook recibido · Mensaje de WhatsApp.
**Lógica:** Condición Si/No (8 operadores) · Switch (3 casos + default) · Establecer variable.
**Datos:** Transformar datos (asignar claves con paths).
**IA:** Generar respuesta · Clasificar intención (usan credencial de IA; sin ella, un proveedor de desarrollo sin costo).
**Integraciones:** HTTP Request (con protección contra IPs internas).
**WhatsApp:** Enviar mensaje de WhatsApp (real con credencial; simulado sin ella).
**Comunicación:** Respuesta (mensaje final del flujo).

> Agregar un nodo nuevo: ver `NODE_DEVELOPMENT.md` (un archivo + una línea en el registro).

---

## Credenciales

**Credenciales → Nueva credencial**. Tipos: OpenAI, Anthropic, Gemini, WhatsApp Cloud, SMTP, HTTP Bearer, API Key, PostgreSQL, Supabase.

- Los secretos se **cifran** (AES-256-GCM) al guardar y **nunca vuelven** a mostrarse (solo un hint enmascarado).
- **Probar conexión** (para OpenAI/Anthropic/WhatsApp): valida contra la API real.
- **Editar / rotar:** cambiar el secreto invalida la última verificación.

En los nodos de IA/HTTP/WhatsApp elegís la credencial desde un desplegable filtrado por tipo. Sin credencial, los nodos funcionan en "modo desarrollo".

---

## Integraciones

Catálogo de servicios disponibles con cuántas credenciales tenés conectadas de cada uno. Enlaza a Credenciales para conectarlos.

---

## Variables por entorno

Dentro de un proyecto → **Variables por entorno**. Pestañas Development / Testing / Production. Agregás variables (`CALENDAR_API_URL`, etc.) que los nodos usan con `{{environment.CLAVE}}`. Marcá **Secreta** para que se guarde cifrada y se muestre enmascarada.

---

## Casos de prueba

Dentro de un proyecto → **Casos de prueba → Nuevo caso**: nombre, entrada JSON del disparador y **assertions** sobre el resultado:
- Igual a · Contiene · Existe · No existe · Es de tipo · Mayor/Menor que
- Nodo visitado · Nodo NO visitado · Estado final

Paths disponibles: `output.*`, `nodes.<id>.output.*`, `variables.*`, `trigger.*`.

**Ejecutar** uno o **Ejecutar todos**: cada caso corre el flujo y verifica las assertions (queda como **Pasa**/**Falla** con el detalle de qué assertion falló). Sirve para no romper un bot al editarlo.

---

## Ejecuciones y debugging

**Ejecuciones** (menú global) lista todas las corridas con filtros por estado. El **detalle** muestra el recorrido nodo por nodo (entrada, salida, error, intentos, duración), el disparador, la salida final y los logs. Botones para **reintentar** y abrir el constructor.

---

## Versiones

En el constructor → **Versiones**:
- **Publicar** crea una versión **inmutable** del borrador (con nota opcional). Marcala **estable** (solo una por flujo).
- **Comparar** una versión con el borrador (qué nodos/conexiones cambiaron).
- **Restaurar** una versión al borrador.

Publicá una versión estable antes de exportar.

---

## Exportar (bot listo para producción)

En el constructor → **Exportar → Generar export**. Produce un proyecto Node **independiente** (de la versión estable) con:
- El runtime empaquetado (`dist/main.js`), `workflow.json`, `manifest.json`, `Dockerfile`, `railway.json`, `.env.example`, `README.md`.
- Solo las integraciones que el flujo usa; **sin secretos** (las credenciales se mapean a variables de entorno).

Descargás el **ZIP** (o lo tenés en `output/`). Correrlo:
```bash
cp .env.example .env    # completar las variables que lista
node dist/main.js       # levanta en :PORT o :3000, sin npm install
curl -X POST localhost:3000/run -H 'content-type: application/json' -d '{"text":"hola"}'
```
Endpoints del bot: `GET /health` · `POST /run` · `POST /webhooks/whatsapp` (parsea el payload real de Meta; con credencial de WhatsApp responde por la Cloud API) · `GET /webhooks/whatsapp` (verificación de Meta).

Desplegar: subís el proyecto a GitHub y lo conectás a Railway (detecta el Dockerfile y el healthcheck). El README generado tiene los pasos exactos.

---

## Plantillas

**Plantillas** ofrece puntos de partida: Bot de turnos, FAQ con IA, Clasificación y derivación, Webhook con IA. **Usar plantilla** → elegís cliente y nombre → crea un proyecto nuevo con ese flujo, listo para editar.

---

## Configuración

- **Tu cuenta:** nombre, email, rol.
- **Equipo:** todos los usuarios con acceso. Si sos OWNER, podés cambiar el rol de los demás.
- **Seguridad:** resumen de las protecciones del entorno.

**Roles:** Owner (todo) · Developer (crea/edita proyectos, flujos, credenciales, exporta) · Tester (ejecuta, simula, casos de prueba) · Viewer (solo lectura).

---

## Flujo de trabajo recomendado

1. Crear cliente y proyecto (o usar una plantilla).
2. Armar el flujo en el constructor.
3. Cargar credenciales y variables por entorno si hace falta.
4. Probar con el simulador hasta que responda bien.
5. Guardar casos de prueba de los escenarios clave.
6. Publicar una versión estable.
7. Exportar el runtime, subirlo a GitHub y desplegarlo.
