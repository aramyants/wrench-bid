FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS build
COPY . .
RUN npm run typecheck && npm run test && npm run build

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/app/data/uploads
WORKDIR /app

RUN groupadd --system wrenchbid \
    && useradd --system --gid wrenchbid --home-dir /app wrenchbid \
    && mkdir -p /app/data/uploads \
    && chown -R wrenchbid:wrenchbid /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build --chown=wrenchbid:wrenchbid /app/.output ./.output
COPY --from=build --chown=wrenchbid:wrenchbid /app/migrations ./migrations
COPY --from=build --chown=wrenchbid:wrenchbid /app/scripts ./scripts

USER wrenchbid
EXPOSE 3000
CMD ["sh", "-c", "node scripts/migrate.mjs && exec node .output/server/index.mjs"]

