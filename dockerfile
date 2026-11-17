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
# Stage 2: Production Runtime (Node + GCC/G++ + Python3 + OpenJDK)
# ==========================================
FROM node:20-alpine AS runner

# Install gcc, g++, build-base, python3, and OpenJDK 17
RUN apk add --no-cache \
    build-base \
    gcc \
    g++ \
    python3 \
    openjdk17-jdk

# Set Java environment variables
ENV JAVA_HOME=/usr/lib/jvm/java-17-openjdk
ENV PATH="$JAVA_HOME/bin:${PATH}"

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
