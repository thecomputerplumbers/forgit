# forgit git container.
# Pins walgit so the image is reproducible. Local disk is cache; R2 is the repository.
# Build: docker build -t forgit-git -f services/git/Dockerfile services/git

FROM docker.io/library/node:24-bookworm-slim AS web
RUN corepack enable && corepack prepare pnpm@10 --activate
WORKDIR /src
ARG WALGIT_SHA=80e9a20b29e29aefd16a4dae6f8e274cce85cca5
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && git init \
  && git remote add origin https://github.com/tobi/walgit.git \
  && git fetch --depth 1 origin ${WALGIT_SHA} \
  && git checkout FETCH_HEAD
WORKDIR /src/web
RUN pnpm install --frozen-lockfile && pnpm run build \
  && test -f dist/index.html

FROM docker.io/library/rust:1.97-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends protobuf-compiler libprotobuf-dev pkg-config cmake perl python3 git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /src
ARG WALGIT_SHA=80e9a20b29e29aefd16a4dae6f8e274cce85cca5
RUN git init \
  && git remote add origin https://github.com/tobi/walgit.git \
  && git fetch --depth 1 origin ${WALGIT_SHA} \
  && git checkout FETCH_HEAD
COPY --from=web /src/web/dist ./web/dist
ENV WALGIT_BUILD_SHA=${WALGIT_SHA}
RUN cargo build --release --locked -p walgit-cli --bin walgit \
  && install -D target/release/walgit /out/bin/walgit

FROM docker.io/library/debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends git git-lfs ca-certificates tini curl nginx python3 \
  && rm -rf /var/lib/apt/lists/* \
  && git --version
RUN useradd --uid 1000 --create-home --shell /bin/sh walgit \
  && mkdir -p /etc/walgit /etc/forgit /var/lib/walgit \
  && chown walgit:walgit /var/lib/walgit
COPY --from=build /out/bin/walgit /usr/local/bin/walgit
COPY walgit.toml /etc/walgit/walgit.toml
COPY nginx.conf.template /etc/forgit/nginx.conf.template
COPY forgit-merge.py /usr/local/bin/forgit-merge.py
COPY entrypoint.sh /usr/local/bin/forgit-entrypoint
RUN chmod 755 /usr/local/bin/forgit-merge.py /usr/local/bin/forgit-entrypoint
ENV RUST_LOG=info \
    WALGIT_CONFIG=/etc/walgit/walgit.toml
EXPOSE 8080
VOLUME ["/var/lib/walgit"]
ENTRYPOINT ["tini", "--", "/usr/local/bin/forgit-entrypoint"]
