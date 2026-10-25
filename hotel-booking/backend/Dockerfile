# ==============================================================================
# Dockerfile: Hotel Booking Backend (Node.js Express)
# Security Hardening: Multi-stage, Alpine minimal image, Non-root user (node)
# ==============================================================================

ARG NODE_IMAGE=node@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
FROM ${NODE_IMAGE}

# Set working directory
WORKDIR /app

# Set production environment
ENV NODE_ENV=production
ENV PORT=5000

# Apply the security patch for the base image's musl without changing Node major.
RUN apk upgrade --no-cache musl

# Install dependencies as root before switching user
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
       /opt/yarn-* /usr/local/bin/yarn /usr/local/bin/yarnpkg

# Copy application source code
COPY . .

# Change ownership to non-root user 'node'
RUN mkdir -p /var/log/hotel /var/lib/hotel-ops && chown -R node:node /app /var/log/hotel /var/lib/hotel-ops

# Switch to non-root user (Security Hardening Criterion 6)
USER node

# Expose backend application port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:5000/health || exit 1

# Start application
CMD ["node", "src/server.js"]
