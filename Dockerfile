# Production image: the study app, API and grader in one Node process.
#   docker compose up -d --build      (see docs/operations.md)

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Copies Pyodide, typechecks, builds and checks the bundle for researcher-only data.
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src ./src
COPY --from=build /app/tasks ./tasks
COPY --from=build /app/public/harness.py ./public/harness.py
COPY --from=build /app/analysis ./analysis
COPY --from=build /app/scripts ./scripts
# Study data lives in a volume so it survives rebuilds and container replacement.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
# /api/health answers 503 when the data folder isn't writable or the grader can't start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
CMD ["node", "--import", "tsx", "server/index.ts"]
