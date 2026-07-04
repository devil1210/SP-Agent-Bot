# Stage 1: Build TypeScript
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

# Stage 2: Final Production Image
FROM node:20-slim
WORKDIR /app

# Instalar dependencias del sistema y descargar solo el CLI de Docker
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    python3 \
    python3-pip \
    ffmpeg \
    libchromaprint-tools \
    curl \
    && curl -fsSL https://download.docker.com/linux/static/stable/x86_64/docker-24.0.7.tgz | tar -xz -C /tmp && \
    mv /tmp/docker/docker /usr/local/bin/docker && \
    rm -rf /tmp/docker && \
    apt-get purge -y --auto-remove curl && \
    rm -rf /var/lib/apt/lists/*

# Copiar requisitos de python e instalar
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt && \
    apt-get purge -y --auto-remove python3-pip

# Copiar dependencias de Node e instalar solo las de producción (sin devDependencies)
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copiar archivos compilados y scripts
COPY --from=builder /app/dist ./dist
COPY public ./public
COPY scripts ./scripts

# Comando para ejecutar la app
CMD ["npm", "run", "start"]
