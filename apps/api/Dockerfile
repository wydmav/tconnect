FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/api ./apps/api

RUN npm ci --no-audit --no-fund
RUN npm run build -w @tconnect/shared -w @tconnect/routeros -w @tconnect/api

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/migrations ./apps/api/migrations

WORKDIR /app/apps/api/dist

EXPOSE 3000

CMD ["node", "main.js"]
