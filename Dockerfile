FROM node:20-slim

WORKDIR /app

# Instalar dependencias necesarias para TSX, build, python, ffmpeg y docker CLI
RUN apt-get update && apt-get install -y git python3 python3-pip ffmpeg docker.io curl unzip && rm -rf /var/lib/apt/lists/*

# Instalar Deno (runtime JS requerido por yt-dlp para descifrado de firmas de YouTube)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV DENO_INSTALL="/root/.deno"
ENV PATH="${DENO_INSTALL}/bin:${PATH}"
COPY package*.json requirements.txt ./
RUN npm install
RUN pip3 install --break-system-packages -r requirements.txt

# Copiar el resto del código
COPY . .

# Compilar TypeScript a JavaScript
RUN npm run build

# Comando para ejecutar el bot
CMD ["npm", "run", "start"]
