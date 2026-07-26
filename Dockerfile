FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY Backend ./Backend
COPY Frontend ./Frontend
COPY DB ./DB
COPY docs ./docs

ENV NODE_ENV=production
ENV PORT=3000

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "Backend/server.js"]
