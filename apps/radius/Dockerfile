FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/radius ./apps/radius

RUN npm ci --no-audit --no-fund
RUN npm run build -w @tconnect/shared -w @tconnect/routeros -w @tconnect/radius

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/radius/dist ./apps/radius/dist
COPY apps/radius/src/mikrotik.dict ./apps/radius/dist/mikrotik.dict

WORKDIR /app/apps/radius/dist

EXPOSE 1812/udp
EXPOSE 1813/udp

CMD ["node", "index.js"]
