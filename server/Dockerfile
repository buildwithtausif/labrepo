# ---- Build stage ----
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential python3 libvips-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files
COPY server/package.json server/package-lock.json ./

# Install dependencies (sharp will compile native bindings against libvips)
RUN npm ci

# Copy server source
COPY server/src ./src
COPY server/tsconfig.json ./

# Build TypeScript
RUN npm run build

# ---- Runtime stage ----
FROM node:22-slim AS runtime

# sharp needs libvips at runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    libvips42 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy built output and production dependencies
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY server/drizzle ./drizzle

# Create data directory for dev fallback (SQLite + mock storage)
RUN mkdir -p /app/data && chown -R node:node /app

USER node

ENV API_PORT=3001
ENV API_HOST=0.0.0.0
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3001/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
