FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
COPY packages ./packages
COPY apps/admin ./apps/admin
RUN if [ -f package-lock.json ]; then cp package-lock.json . && npm ci; else npm install --no-audit --no-fund; fi
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @tconnect/admin

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=build /app/apps/admin/.next/standalone ./
COPY --from=build /app/apps/admin/.next/static ./apps/admin/.next/static
EXPOSE 3000
CMD ["node", "server.js"]