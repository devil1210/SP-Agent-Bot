# 🤖 Guía de Comandos SP-Agent (V4.2)

Esta guía detalla todos los comandos disponibles para administrar y configurar tu bot de Telegram.

> [!IMPORTANT]
> La mayoría de estos comandos solo pueden ser ejecutados por los administradores autorizados.

---

## 🔐 Gestión de Acceso y Visibilidad

### `/groups`
Mapea tu imperio. Muestra todos los grupos autorizados y **descubre los nombres de sus hilos**.
- Indica qué rol tiene el bot en cada hilo (🎭, 🧐 o 🤖).

### `/allowgroup [ID]`
Autoriza un grupo para que el bot pueda operar en él.
- **Uso en privado**: `/allowgroup -100123456789`
- **Uso en grupo**: `/allowgroup` (Autoriza el grupo actual).

### `/revokegroup [ID]`
Quita la autorización a un grupo. 

---

## ⚙️ Personalidad y Estilo

### `/persona [instrucciones]`
Configura cómo habla el bot. Puedes hacerlo desde cualquier chat:
- **Chat Actual**: `/persona eres un pirata`
- **Otro Grupo**: `/persona -100123456789 eres un pirata`
- **Consultar**: `/persona` o `/persona -100123456789` (Muestra la personalidad actual).
- **Restablecer**: `/persona default` (Vuelve al estilo breve y directo).

### `/model [nombre_modelo]`
Cambia el motor de IA (ej: `gemini-3.1-flash-lite-preview`).

---

## 🧵 Gestión de Hilos y Roles
Configura el nivel de intervención del bot en cada hilo (Topic) de un grupo.

### `/topics [miembro | consultor | asistente | disable]`
Define el comportamiento en el hilo actual o a distancia:
- **🎭 Miembro**: Participación activa. Lee todo y responde solo si es relevante.
- **🧐 Consultor**: Modo "mano levantada". Lee todo para tener contexto, pero **solo habla si lo mencionas o citas**.
- **🤖 Asistente**: Reactivo puro. Solo responde si lo mencionas. No guarda memoria del resto de la charla.
- **❌ Disable**: Apaga el bot en ese hilo.

**Uso desde Privado:**
- `/topics [group_id] [thread_id] [rol]`

---

## 📢 Comunicación Remota

### `/say [ID_GRUPO] [ID_HILO] [mensaje]`
Habla a través del bot en cualquier grupo autorizado.
- **Ejemplo**: `/say -100... 42 ¡Atención bibliotecarios, hay nuevas actualizaciones!`

---

## 🧹 Utilidades

### `/clear`
Borra la memoria temporal del chat o hilo actual.

### `/start`
Mensaje de bienvenida y estado del sistema.

---

## 💡 Tips de Uso
- **Auto-Descubrimiento**: Si un hilo aparece solo con número en `/groups`, simplemente escribe un mensaje allí y el bot aprenderá su nombre automáticamente.
- **Silencio Inteligente**: En modo Miembro, el bot sabe cuándo callar para no molestar si no tiene nada valioso que aportar.
- **Multi-Hilo**: Puedes tener el bot en modo "Consultor" en la biblioteca y como "Miembro" en el grupo de charla al mismo tiempo.

---
*Documento actualizado al 12 de marzo de 2026.*
