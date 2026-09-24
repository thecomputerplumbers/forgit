FROM --platform=linux/amd64 docker.io/library/node:26.8.2-bookworm-slim AS node
FROM docker.io/cloudflare/sandbox:0.12.1@sha256:ea9b35e61c800eddbc4450fad333e5dd26033a06f7d36624388b0711bef9f8c5
RUN rm -rf /usr/local/lib/node_modules/npm
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && npm install --global pnpm@12.5.1 --allow-scripts=pnpm \
  && node --version && pnpm --version
