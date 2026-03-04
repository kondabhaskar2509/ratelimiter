FROM node:20-alpine
WORKDIR /ratelimiter

COPY package*.json ./
RUN npm ci

COPY . .

EXPOSE 5000
CMD ["node", "server.js"]