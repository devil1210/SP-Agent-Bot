# 🤖 Guía de Comandos SP-Agent

Esta guía detalla todos los comandos disponibles para administrar y configurar tu bot de Telegram.

> [!IMPORTANT]
> La mayoría de estos comandos solo pueden ser ejecutados por los usuarios listados en `TELEGRAM_ALLOWED_USER_IDS` dentro del archivo `.env`.

---

## 🔐 Gestión de Acceso (Grupos)

### `/allowgroup [ID]`
Autoriza un grupo para que el bot pueda operar en él.
- **Uso en privado**: `/allowgroup -100123456789` (Autoriza ese ID específico).
- **Uso en grupo**: `/allowgroup` (Autoriza el grupo actual donde estás escribiendo).

### `/revokegroup [ID]`
Quita la autorización a un grupo. El bot dejará de responder y se saldrá si intenta ser usado.
- **Ejemplo**: `/revokegroup -100123456789`

---

## ⚙️ Configuración del Modelo e Inteligencia

### `/model [nombre_modelo]`
Cambia el motor de Inteligencia Artificial que usa el bot para ese chat específico.
- **Ejemplo**: `/model gemini-3.1-flash-lite-preview`
- **Nota**: El sistema tiene un mapeo inteligente para corregir nombres cortos.

### `/persona [instrucciones]`
Define una personalidad o comportamiento específico para el bot en el chat actual.
- **Ejemplo**: `/persona Eres un experto en ciberseguridad, responde de forma técnica pero sarcástica.`
- **Restablecer**: `/persona default` (Vuelve a la personalidad estándar).

---

## 🧵 Gestión de Hilos (Forums / Topics)
*Solo para grupos que tienen activada la función de "Temas" (Forums).*

### `/topics enable`
Habilita el bot para que escuche y responda en el **hilo actual**.

### `/topics disable`
Deshabilita al bot en el hilo actual.

### `/topics all`
El bot escuchará y participará en **todos** los hilos del grupo (Modo abierto).

### `/topics none`
El bot entrará en "Modo Silencio". Solo guardará cosas en memoria pero **no responderá a menos que sea mencionado** o se le responda directamente.

---

## 🧹 Utilidades

### `/clear`
Borra la memoria temporal (contexto reciente) del chat o hilo actual. Útil si el bot se ha confundido o quieres empezar una conversación de cero.

### `/start`
Muestra el mensaje de bienvenida y estado actual del bot.

---

## 💡 Tips de Uso en Grupos
- **Mención**: Para que el bot te responda en un grupo, escribe `@nombre_del_bot`.
- **Cita/Reply**: Si respondes a un mensaje del bot, él entenderá que le estás hablando a él.
- **Memoria Silenciosa**: El bot lee todos los mensajes en grupos autorizados para aprender contexto, pero solo interviene cuando se le solicita.

---
*Documento generado el 12 de marzo de 2026 por SP-Agent.*
