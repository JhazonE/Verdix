# Stage 1: Install dependencies and build
FROM node:20-alpine AS builder
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm install

# Copy source code
COPY . .

# Server Action ids are derived from this key AT BUILD TIME (next build calls
# generateEncryptionKeyBase64, which returns process.env.NEXT_SERVER_ACTIONS_
# ENCRYPTION_KEY when set and otherwise generates a random one). Railway only
# injects service variables into the RUNTIME container, so without this ARG the
# build never sees the key and every deploy mints a fresh set of action ids —
# producing "Failed to find Server Action" on every already-loaded page, and
# permanently across replicas that each built their own key.
#
# Railway passes service variables as build args, so declaring the ARG is
# enough; ENV then exposes it to `npm run build` below.
ARG NEXT_SERVER_ACTIONS_ENCRYPTION_KEY
ENV NEXT_SERVER_ACTIONS_ENCRYPTION_KEY=$NEXT_SERVER_ACTIONS_ENCRYPTION_KEY

# Same reason: generateBuildId reads this to pin the build id.
ARG RAILWAY_GIT_COMMIT_SHA
ENV RAILWAY_GIT_COMMIT_SHA=$RAILWAY_GIT_COMMIT_SHA

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
