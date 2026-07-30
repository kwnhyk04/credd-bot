FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    fontconfig \
    fonts-dejavu-core \
    fonts-liberation \
    fonts-noto-core \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY --chown=node:node . .

RUN mkdir -p /data/credd-asset-cache \
    && chown -R node:node /app /data/credd-asset-cache

USER node

CMD ["npm", "start"]