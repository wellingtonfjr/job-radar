# job-radar: one image with the API and the built frontend.
#
#   docker build -t job-radar .
#   docker run -p 8080:8080 -v job-radar-data:/data job-radar
#
# Two stages: "build" has every tool needed to install and compile; the
# final stage gets only what the app needs to run.

# ───────────────────────── Stage 1: build ─────────────────────────
FROM node:26-bookworm-slim AS build

# Compilers for better-sqlite3's native module, used only if a prebuilt
# binary can't be downloaded. They stay in this stage only.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dependencies first: this layer is reused from cache when only code changes.
COPY backend/package.json backend/package-lock.json backend/
COPY frontend/package.json frontend/package-lock.json frontend/
RUN npm --prefix backend ci && npm --prefix frontend ci

# Then the code, and both builds.
COPY backend/ backend/
COPY frontend/ frontend/
RUN npm --prefix frontend run build && npm --prefix backend run build

# Keep only production dependencies (Express, better-sqlite3, …) for the
# final stage; TypeScript, vitest and friends are dropped here.
RUN npm --prefix backend prune --omit=dev

# ───────────────────────── Stage 2: runtime ─────────────────────────
FROM node:26-bookworm-slim

ENV NODE_ENV=production \
    PORT=8080 \
    DB_PATH=/data/job-radar.db

WORKDIR /app

# Only what runs: compiled backend, its production dependencies, and the
# built frontend (served by the backend from /app/frontend/dist). Files stay
# owned by root, so the app can read but not modify its own code.
COPY --from=build /app/backend/package.json backend/package.json
COPY --from=build /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/frontend/dist frontend/dist

# The SQLite database lives on a volume mounted here, writable by the app's
# unprivileged user.
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Never run as root: the node user ships with the base image.
USER node

EXPOSE 8080

CMD ["node", "backend/dist/index.js"]
