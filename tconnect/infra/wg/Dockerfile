FROM node:22-alpine
RUN apk add --no-cache wireguard-tools bash iproute2
WORKDIR /app
COPY manager.js entrypoint.sh ./
RUN chmod +x entrypoint.sh
ENTRYPOINT ["./entrypoint.sh"]