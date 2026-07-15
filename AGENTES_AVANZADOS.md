# IF Nodes — Roadmap de capacidades para agentes avanzados

Qué **capacidades de plataforma** hay que agregarle a IF Nodes para que el sistema
(y el Copilot) puedan construir **cualquier agente avanzado**, no un caso puntual.
Son primitivas genéricas: memoria, herramientas, conocimiento, contactos, programación,
canales, handoff. El agente de **FePI es solo un ejemplo** que se usa al final (§3) para
mostrar cómo estas piezas se combinan en un caso real — pero el objetivo es que estén en
el sistema para todos los agentes que armemos.

> **Clave:** el **Copilot no crea capacidades**, solo arma flujos con los nodos que
> existen. Apenas se suma un nodo o subsistema al registro, el Copilot lo empieza a
> usar solo (lee el registro de nodos). Así que este roadmap es de **plataforma**,
> no del Copilot: construir estas piezas es lo que desbloquea que el Copilot (y vos)
> puedan armar agentes avanzados de cualquier tipo.

---

## ✅ ESTADO (2026-07-15): Opción B TOTAL — el bot completo corre en el stack del cliente

El runtime exportado ya no es de un solo flujo: **`POST /projects/:id/export` bundlea TODO
el proyecto** (todos los flujos en `flows.json`) con un **orquestador** que rutea la entrada
al flujo inbound, expone `POST /campaigns/run` (fan-out por contacto sobre los contactos
persistidos), lista `GET /flows`, y arranca un **scheduler cron propio** (sin deps) para los
flujos `trigger.schedule`. Persistencia en el Postgres/Supabase del cliente (memoria +
contactos + CRM). Verificado E2E con el bot real de FePI (3 flujos, 482 KB, boot + ruteo +
campaña real). Botón **"Exportar bot"** en el detalle del proyecto. Los **2030 contactos
reales** de FePI ya están importados en el CRM. Queda solo setup externo del usuario (HSM de
Meta para WhatsApp saliente masivo, OAuth de Google para Calendar) y mejoras futuras
(embeddings para el RAG, tool-calling de OpenAI, suspensión de ejecuciones largas).

## ✅ ESTADO (2026-07-12): TODOS los bloques construidos

Las capacidades del roadmap ya están en el sistema (24 nodos, 156 tests):

- ✅ **Memoria de conversación** (nodos Cargar historial / Guardar turno)
- ✅ **Nodo Agente IA con herramientas** (loop tool-calling + HTTP/memoria/tools a medida)
- ✅ **RAG / base de conocimiento** (nodo Buscar conocimiento + UI para cargar material; v1 por keywords)
- ✅ **Cron + Esperar** (disparador Programado + scheduler; nodo Esperar)
- ✅ **Email/SMTP** (nodo Enviar email)
- ✅ **Contactos / CRM** (nodos upsert/find + bandeja/UI con estados)
- ✅ **Escalar a humano** (nodo Escalar + estado handoff) + **Bandeja de operador** (UI con historial)
- ✅ **Campañas / outreach masivo** (disparador Campaña + fan-out: una ejecución por contacto, con ritmo)
- ✅ **Google Calendar** (nodo Crear evento)
- ✅ **Puesta en marcha** (checklist determinístico de qué falta conectar/cargar, en el constructor y en el Copilot)
- ✅ **Copilot Fase 3 — orquestación multi-flujo**: botón "Generar con IA" en el proyecto → arma **varios flujos + siembra conocimiento** de un solo prompt (los secretos los cargás vos)

**Dependen de setup EXTERNO tuyo (el sistema ya lo soporta, falta tu cuenta):**
- **WhatsApp saliente masivo** → plantillas **HSM aprobadas** por Meta (tu WhatsApp Business).
- **Google Calendar** → **access token OAuth** de Google (app en Google Cloud), cargado como credencial HTTP Bearer.

**Mejoras futuras (no bloquean):** RAG con embeddings (hoy keyword literal), OAuth de Google con refresh automático, tool-calling real para OpenAI, persistencia con DB de memoria/contactos en el runtime exportado (hoy efímera).

---

## 1. Estado actual (lo que ya se puede)

- **Conversación por mensaje**: trigger de WhatsApp → IA (generar/clasificar) → responder. ✅
- **Lógica**: condición (8 operadores), switch, variables. ✅
- **Integraciones salientes**: HTTP request (con SSRF), enviar WhatsApp. ✅
- **IA**: generar respuesta y clasificar intención (OpenAI/Anthropic/Gemini). ✅
- **Credenciales cifradas**, variables por entorno, versionado, **export a runtime** desplegable. ✅
- **Copilot** que explica, propone y **arma flujos** (add/connect/config/delete) con revisión. ✅

**Límite de fondo:** hoy **cada mensaje es una ejecución independiente y sin estado**.
No hay memoria, ni lista de contactos, ni tareas programadas, ni email, ni base de
conocimiento. Eso alcanza para un bot reactivo simple; **no** para un agente que
sostiene conversaciones, hace campañas y da seguimiento.

---

## 2. Lo que falta — por subsistema

Tamaño estimado: **S** (días) · **M** (1–2 semanas) · **L** (3+ semanas). El orden
importa: hay dependencias.

### 2.1 Memoria de conversación · **crítico** · M
**Qué es:** que el agente recuerde lo dicho antes con cada contacto, entre mensajes.
**Por qué:** sin esto no hay agente conversacional real (repite, no da seguimiento coherente).
**Qué implica construir:**
- Modelo `Conversation` (por canal + contacto) y `ConversationMessage` (historial).
- El motor deja de tratar cada mensaje como aislado: carga/actualiza la conversación por ejecución.
- Nodos: **Cargar historial** (inyecta las últimas N vueltas al prompt de IA) y **Guardar turno**.
- Resumen/compactación cuando la charla es larga (para no reventar tokens).

### 2.2 Contactos / CRM · **crítico** · L
**Qué es:** una base de contactos con estado por contacto (nuevo, contactado, respondió, en reunión, cerrado…).
**Por qué:** outreach y seguimiento necesitan saber a quién ya escribiste y en qué punto está cada uno.
**Qué implica:**
- El modelo `Contact` ya existe; faltan **nodos** Crear/Buscar/Actualizar contacto y un campo de **estado/etiquetas**.
- Bandeja/listado de contactos en la web (ver estado, historial, notas).
- Import de contactos (CSV) para arrancar una campaña.

### 2.3 Disparador programado (cron) + nodo Esperar · M
**Qué es:** correr flujos por tiempo ("todos los días 9am", "a las 48h de no responder").
**Por qué:** los **follow-ups automáticos** y las campañas dependen de esto.
**Qué implica:**
- Trigger `schedule` (cron) — ya hay Redis/BullMQ, se apoya en jobs programados.
- Nodo **Esperar** (delay/hasta fecha) para pausar una rama sin bloquear el worker.

### 2.4 Motor de campañas / outreach masivo · L
**Qué es:** recorrer una lista de contactos y mandarles el mensaje inicial personalizado, con control de ritmo y registro.
**Por qué:** es el punto 2 del caso FePI (contacto masivo WhatsApp + email).
**Qué implica:**
- Entidad `Campaign` (a quién, por qué canal, con qué plantilla, estado por contacto).
- Nodo/mecanismo de **iterar lista** (batch) con **throttle** (no reventar límites del canal).
- Personalización por contacto (variables) + **deduplicación** (no escribir dos veces).
- **WhatsApp: plantillas HSM.** Para **iniciar** una conversación saliente (a alguien que no escribió primero) Meta **exige plantillas aprobadas**; no se puede mandar texto libre fuera de la ventana de 24h. Hay que soportar envío de plantillas + gestión de la ventana de 24h. **(Restricción dura del canal, no nuestra.)**

### 2.5 Nodo Email / SMTP · S–M
**Qué es:** enviar emails (canal 2 del outreach).
**Por qué:** el caso pide WhatsApp **+ email**.
**Qué implica:** la credencial SMTP ya existe; falta el **nodo Enviar email** (to, asunto, cuerpo, adjuntos) y opcional recepción/tracking de aperturas.

### 2.6 Handoff a operador humano · M
**Qué es:** pasar el lead a una persona con todo el historial y sin perder el hilo.
**Por qué:** punto 5 del caso.
**Qué implica:**
- Estado `HANDOFF` en la conversación (el bot deja de responder ese hilo).
- Notificación al operador (WhatsApp/email/HTTP) + **bandeja de operador** en la web con el historial.
- (Fase 1 del cliente: un operador. Multi-operador con asignación/reparto = más adelante.)

### 2.7 Google Calendar · M
**Qué es:** agendar la reunión confirmada.
**Por qué:** punto 5.
**Opciones:**
- **Simple:** el operador agenda a mano en su Calendar → el bot solo hace el handoff. **0 desarrollo.**
- **Automático:** nodo **Google Calendar** (OAuth + crear evento) o vía nodo HTTP contra la API. Requiere flujo OAuth de Google.

### 2.8 Base de conocimiento / RAG · L (o atajo S)
**Qué es:** que el agente "estudie" material (los ~3.000 chats + bases) y responda con ese conocimiento y tono.
**Por qué:** punto 1 del caso.
**Opciones:**
- **Atajo (recomendado para arrancar):** destilar a mano un documento de **tono + objeciones + FAQ** y meterlo en el prompt del nodo de IA. Captura ~80% del valor ("hablar como FePI", responder FAQ) **sin** RAG. Esfuerzo: S.
- **RAG completo:** ingesta → **embeddings** → vector store → nodo **Recuperar contexto** que inyecta lo relevante al prompt. Necesario si el material es grande y cambia seguido. Esfuerzo: L (subsistema nuevo + dependencia de un vector store).

### 2.9 Nodo "Agente IA" con herramientas · **núcleo de agentes avanzados** · L
**Qué es:** un nodo que corre un LLM en **loop con herramientas** — el modelo decide qué
acción tomar (buscar, llamar una API, consultar la base, escribir) hasta cumplir el objetivo,
en vez de tener cada rama cableada a mano en el grafo.
**Por qué:** es **la** primitiva que distingue "bot con reglas" de "agente" de verdad.
Para casos acotados alcanza con grafo + memoria + clasificar; pero para agentes abiertos
y reutilizables, este nodo es el corazón. Le das objetivo + herramientas y se maneja.
**Qué implica:** motor de tool-calling (Anthropic/OpenAI), registro de "herramientas"
que el agente puede usar (que en el fondo son nuestros propios nodos: HTTP, buscar contacto,
recuperar conocimiento, agendar…), límites de pasos/costo, y trazas de qué hizo.
**Nota:** para FePI puntual no es obligatorio, pero para "que el sistema haga agentes
avanzados en general" **es la pieza central**.

### 2.10 Soporte transversal (se necesita sí o sí para producción)
- **Ventana de 24h de WhatsApp** y estados de entrega (delivered/read) vía webhooks de Meta. · M
- **Colas/rate-limit por contacto** para no cruzar mensajes ni pasarse de los límites del canal. · S–M (ya hay BullMQ).
- **Métricas de campaña** (enviados, respondidos, reuniones). · S

---

## 3. Mapeo al caso FePI

| # | Lo que piden | Estado | Qué lo desbloquea |
|---|---|---|---|
| 1 | Estudiar 3.000 chats + tono FePI | 🔴 / 🟡 | 2.8 RAG (o atajo: prompt curado) |
| 2 | Outreach masivo WhatsApp + email | 🔴 | 2.4 campañas + 2.5 email + plantillas HSM + 2.2 contactos |
| 3 | Conversación + seguimiento automático | 🔴 | 2.1 memoria + 2.3 cron/esperar + 2.2 estado de contacto |
| 4 | Detección de intención de reunión | 🟢 | ya se hace con **clasificar intención** |
| 5 | Handoff a humano + Google Calendar | 🟡 | 2.6 handoff/bandeja (+ 2.1 memoria); Calendar 2.7 (o manual) |

**Traducción:** el punto 4 ya está; los puntos 1–3–5 dependen de construir memoria,
contactos, cron y handoff; el punto 2 es el más pesado (campañas + email + plantillas).

---

## 4. Plan por fases (orden por dependencias)

**Fase A — Agente conversacional con estado (desbloquea 3, 4, 5-parcial)**
`2.1 memoria` + `2.2 contactos (base)` + `2.6 handoff/bandeja` + atajo `2.8` (prompt FePI).
→ Entregable: bot de WhatsApp que **conversa con memoria**, responde FAQ con tono FePI,
detecta intención y **pasa al operador con el historial**. Reunión: el operador agenda a mano.
**Esto ya es demostrable y vendible.**

**Fase B — Seguimiento automático**
`2.3 cron + Esperar` + estado de contacto (de 2.2).
→ Follow-ups a los que no respondieron / quedaron a mitad de camino.

**Fase C — Outreach masivo**
`2.5 email` + `2.4 campañas` + `plantillas HSM` + import CSV + `2.10 rate-limit/métricas`.
→ Campañas iniciales personalizadas por los dos canales.

**Fase D — Extras según necesidad**
`2.7 Google Calendar automático` · `2.8 RAG completo` · `2.9 nodo Agente`.

---

## 5. Notas importantes

- **El Copilot escala solo:** cada nodo nuevo que se registra, el Copilot lo puede
  proponer y aplicar sin tocar el Copilot. No hay trabajo extra de Copilot por nodo.
- **Restricciones que no dependen de nosotros:** las **plantillas HSM** y la **ventana de
  24h** son de WhatsApp/Meta; hay que aprobar plantillas y tener número de WhatsApp Cloud.
  Google Calendar automático necesita OAuth de Google.
- **Costo de IA en producción:** con memoria + RAG el prompt crece → más tokens por
  mensaje. Conviene medir con `count_tokens` y elegir modelo por caso (Sonnet/Haiku para
  volumen, Opus para lo delicado). Ver el estimado en la conversación del Copilot.
- **Privacidad:** contactos y conversaciones son datos de personas → aplican las mismas
  reglas de redacción/cifrado que ya usa el sistema; nada de secretos en logs.

---

**Resumen para el cliente:** el punto 4 ya funciona; con la **Fase A** tenés un agente
conversacional real con handoff (lo más vistoso) en el corto plazo; el outreach masivo
(Fase C) es el bloque más grande. Nada de esto lo "inventa" el Copilot: son piezas de
plataforma a construir, y una vez que están, el Copilot arma los flujos que las usan.
