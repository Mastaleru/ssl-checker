FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
ENV PORT=8080 \
    NODE_ENV=production
USER node
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:8080/v1/health >/dev/null || exit 1
CMD ["node", "server.mjs"]
