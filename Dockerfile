FROM node:20-alpine

WORKDIR /app

# Install dependencies first (cacheable layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# Server code only — client is served from GitHub Pages
COPY server/ ./server/

# Game logs persist via volume mount
RUN mkdir -p gamelogs

EXPOSE 3000

CMD ["node", "server/index.js"]
