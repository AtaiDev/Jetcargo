# Backend Jetcargo для облака (Render, бесплатный тариф).
#
# Диск бесплатного Render не сохраняется между перезапусками, поэтому база
# непрерывно копируется Litestream в Backblaze B2 и восстанавливается при старте
# (см. docker-entrypoint.sh, litestream.yml).
FROM node:24-slim

ARG LITESTREAM_VERSION=0.3.13
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates wget \
 && wget -qO /tmp/ls.deb "https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-amd64.deb" \
 && dpkg -i /tmp/ls.deb && rm /tmp/ls.deb \
 && apt-get purge -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=10000
EXPOSE 10000

ENTRYPOINT ["docker-entrypoint.sh"]
