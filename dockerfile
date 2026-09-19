# ==========================================
# Stage 1: Build Frontend (Vite + React)
# ==========================================
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend

# Copy frontend dependency files & install
COPY frontend/package*.json ./
RUN npm install

# Copy frontend source files & build
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Production Runtime (Node + g++)
# ==========================================
FROM node:20-alpine AS runner

# Install g++ compiler & build tools for C++ execution
RUN apk add --no-cache g++ build-base

WORKDIR /app

# Copy backend dependencies & install
COPY backend/package*.json ./
RUN npm install --production

# Copy backend source files
COPY backend/ ./

# Copy compiled static frontend from Stage 1 into backend public directory
COPY --from=frontend-builder /app/frontend/dist ./public

EXPOSE 3000

CMD ["node", "server.js"]
