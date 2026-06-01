# DockCraft — multi-stage build.
# Build context is the repo ROOT (see docker-compose.yml), so both the
# frontend/ and backend/ directories are available here.

# ---- Stage 1: build the Adminator-based frontend ----
FROM node:18-alpine AS frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend runtime ----
FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
# Bring in the compiled frontend so Express can serve it.
COPY --from=frontend /frontend/dist ./frontend/dist
ENV FRONTEND_DIST=/app/frontend/dist
ENV PORT=3000
EXPOSE 3000
CMD ["node", "index.js"]
