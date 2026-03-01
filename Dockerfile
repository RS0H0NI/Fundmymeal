# Stage 1: Build React frontend
FROM node:18-alpine as frontend-builder
WORKDIR /app/frontend

# Copy frontend package files
COPY frontend/package*.json ./

# Install dependencies
RUN npm install

# Copy frontend source and config files
COPY frontend/src ./src
COPY frontend/public ./public
COPY frontend/index.html ./
COPY frontend/vite.config.js ./
COPY frontend/tailwind.config.js ./
COPY frontend/postcss.config.js ./
COPY frontend/eslint.config.js ./

# Build React app
RUN npm run build

# Stage 2: Run Express backend with React frontend
FROM node:18-alpine
WORKDIR /app/api

# Copy backend package files
COPY api/package*.json ./

# Install backend dependencies
RUN npm install

# Copy backend server
COPY api/server.js .

# Copy built React frontend from previous stage
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# Set environment
ENV NODE_ENV=production
ENV PORT=8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (r) => {r.statusCode !== 200 && process.exit(1)})"

# Expose port
EXPOSE 8080

# Start server
CMD ["node", "server.js"]
