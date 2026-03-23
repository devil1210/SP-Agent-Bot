# 🤖 SP-Agent Bot

Agente de Inteligencia Artificial avanzado para Telegram con capacidades multimodelo, gestión de conocimientos selectivos y herramientas de automatización.

---

## 🌟 Características Principales

- **🧠 Inteligencia Multimodelo**: Soporte para Gemini (Google), Groq y OpenRouter. Sistema de fallback automático si un proveedor falla.
- **🛡️ Gestión de Grupos**: Sistema de autorización ("Whitelisting") para controlar exactamente dónde puede operar el bot.
- **🧩 Módulos de Conocimiento (Features)**: Habilita conocimientos específicos por chat (Biblioteca, Desarrollo Main, Desarrollo V4).
- **🧵 Hilos y Topics**: Compatible con grupos de tipo Foro. Soporta roles de intervención (Miembro, Consultor, Asistente).
- **🔄 Conversión FXTwitter**: Corrige enlaces de Twitter/X automáticamente para una mejor visualización, mencionando al autor y limpiando el chat.
- **🖼️ Análisis Multimedia**: Capacidad para "ver" imágenes y procesar contexto visual junto con el texto.
- **💾 Memoria Contextual**: Almacenamiento de conversaciones en base de datos (Supabase) para mantener el hilo de la conversación.

---

## 🚀 Instalación y Despliegue

### Requisitos Previos
- Node.js v20 o superior.
- Una cuenta en Supabase.
- API Keys de Telegram, Google Gemini, Groq (opcional) y OpenRouter (opcional).

### Pasos

1. **Clonar el repositorio**:
   ```bash
   git clone https://github.com/devil1210/SP-Agent-Bot.git
   cd SP-Agent-Bot
   ```

2. **Instalar dependencias**:
   ```bash
   npm install
   ```

3. **Configurar variables de entorno**:
   Copia el archivo `.env.example` a `.env` y rellena tus claves:
   ```bash
   cp .env.example .env
   ```

4. **Ejecutar en desarrollo**:
   ```bash
   npm run dev
   ```

5. **Producción**:
   ```bash
   npm start
   ```

---

## 🐳 Docker

El proyecto está listo para ser desplegado con Docker:

```bash
docker compose up -d
```

---

## 📖 Comandos y Uso

Para una guía detallada de comandos, consulta el archivo [COMANDOS.md](./COMANDOS.md).

### Comandos Rápidos:
- `/features`: Gestiona los módulos de conocimiento del grupo.
- `/persona`: Cambia el estilo de respuesta del bot.
- `/topics`: Configura el nivel de participación en hilos específicos.
- `/groups`: Descubre los IDs de los hilos de un foro.

---

## 🛠️ Tecnologías

- **GrammY**: Framework de Telegram ligero y potente.
- **Typescript**: Tipado fuerte para un código más robusto.
- **Supabase**: Backend como servicio para la base de datos y memoria.
- **LLMs**: Integración con las APIs de IA más avanzadas.

---

## 📄 Licencia
Este proyecto es privado. Todos los derechos reservados.

## 🗣️ Idioma de Interacción
Como regla establecida en este proyecto, todas las interacciones, documentación técnica, mensajes de error y respuestas generadas por el agente deben ser exclusivamente en **español**.

