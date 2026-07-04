# Stage 1: Builder
FROM node:20-slim AS builder
WORKDIR /app

# Instalar curl, tar, xz-utils para descargar binarios
RUN apt-get update && apt-get install -y curl tar xz-utils python3 python3-pip

# 1. Compilar TypeScript
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# 2. Descargar Docker CLI estático
RUN curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-24.0.7.tgz | tar -xz -C /tmp && \
    mv /tmp/docker/docker /app/docker

# 3. Descargar FFmpeg y FFprobe estáticos
RUN curl -fsSL https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz | tar -xJ -C /tmp && \
    mv /tmp/ffmpeg-*-amd64-static/ffmpeg /app/ffmpeg && \
    mv /tmp/ffmpeg-*-amd64-static/ffprobe /app/ffprobe

# 4. Instalar dependencias de Python en un directorio local
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages --target=/app/python_packages -r requirements.txt


# Stage 2: Final Production Image
FROM node:20-slim
WORKDIR /app

# Instalar solo dependencias runtime básicas
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    libchromaprint-tools \
    && rm -rf /var/lib/apt/lists/*

# Copiar binarios y paquetes de Python desde el builder
COPY --from=builder /app/docker /usr/local/bin/docker
COPY --from=builder /app/ffmpeg /usr/local/bin/ffmpeg
COPY --from=builder /app/ffprobe /usr/local/bin/ffprobe
COPY --from=builder /app/python_packages ./python_packages

# Copiar dependencias de Node e instalar solo producción
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copiar compilado y scripts
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY scripts ./scripts

# Configurar PYTHONPATH para que Python encuentre los paquetes copiados
ENV PYTHONPATH=/app/python_packages

# Comando para ejecutar la app
CMD ["npm", "run", "start"]
