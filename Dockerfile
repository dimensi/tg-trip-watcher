FROM node:24-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.json eslint.config.js ./
RUN npm ci
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD node -e "process.exit(0)"
CMD ["node", "dist/index.js"]
