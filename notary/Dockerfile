# SSL Checker notary. Run it with compose.yaml, next to this file.
#
# For a reproducible image, pin the base by digest when you deploy:
#   docker buildx imagetools inspect node:24-alpine
# then use FROM node:24-alpine@sha256:<digest>.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src

USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "src/healthcheck.js"]
CMD ["node", "src/main.js"]
