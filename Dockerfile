FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY src ./src
COPY public ./public
COPY eval ./eval
COPY scripts ./scripts

EXPOSE 4000

CMD ["node", "src/server.js"]