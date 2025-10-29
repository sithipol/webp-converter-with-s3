# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Install system dependencies required for Sharp
RUN apk add --no-cache \
    libc6-compat \
    vips-dev \
    build-base \
    python3 \
    make \
    g++

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Remove devDependencies after build to reduce image size
RUN npm prune --production

# Create logs directory
RUN mkdir -p logs

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S webp -u 1001

# Change ownership of app directory
RUN chown -R webp:nodejs /app

# Switch to non-root user
USER webp

# Expose port
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node dist/cli.js health || exit 1

# Default command - can be overridden
CMD ["npm", "run", "cli", "health"]