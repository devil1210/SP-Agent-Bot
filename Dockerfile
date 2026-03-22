FROM node:20-slim

WORKDIR /app

# Instalar dependencias necesarias para TSX y build
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

# Comando para ejecutar el bot directamente con tsx
CMD ["npm", "run", "start"]
