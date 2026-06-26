FROM node:20-slim

WORKDIR /app

# Instalar dependencias necesarias para TSX, build, python, ffmpeg y docker CLI
RUN apt-get update && apt-get install -y git python3 python3-pip ffmpeg docker.io && rm -rf /var/lib/apt/lists/*
COPY package*.json requirements.txt ./
RUN npm install
RUN pip3 install --break-system-packages -r requirements.txt

# Copiar el resto del código
COPY . .

# Compilar TypeScript a JavaScript
RUN npm run build

# Comando para ejecutar el bot (recompila TS en cada arranque para aplicar cambios via git pull)
CMD ["npm", "run", "start"]
