# Stage 1: Install dependencies and build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Run Next.js build
RUN npm run build

# Stage 2: Runner
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

# Copy standalone files from builder stage
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# Next 16's standalone output tracing drops runtime modules for this project
# (Turbopack app-route runtime, node-cron, next internals like ./cpu-profile),
# crashing routes/scheduler at runtime. Overlay the full node_modules so every
# runtime dependency is present regardless of what tracing missed.
COPY --from=builder /app/node_modules ./node_modules

# The release command runs `npm run migrate` before this image starts serving,
# so the runtime stage needs the migration sources and the scripts that declare
# them. Next's standalone output only contains the app bundle — it deliberately
# excludes scripts/ — so copy them in explicitly. tsx resolves from the builder
# node_modules overlaid above (it is a devDependency, but that stage installs
# with npm install before NODE_ENV=production, so it is present).
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/tsconfig.json ./tsconfig.json

# Expose port
EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Run the standalone server
CMD ["node", "server.js"]
