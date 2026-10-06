# One image: the simplex-chat CLI (the bot's SimpleX identity) and the bot
# process, supervised by entrypoint.sh, running as the unprivileged user `bot`
# (uid 1000). Build context = repository root.
#
#   SIMPLEX_VERSION  release to download (e.g. 7.0.2); a binary placed in docker/cli/bin/simplex-chat
#                    by docker/cli/fetch-cli.sh takes precedence
#   SIMPLEX_SHA256   expected SHA-256 of the downloaded binary; verified when non-empty
#   BUILD_INFO       shown in the start-up log
FROM ubuntu:24.04
ARG SIMPLEX_VERSION=7.0.2
ARG SIMPLEX_SHA256=895fb14cfaa662d1c0947f2f871141fc89680fe3e70bff64c366cbe9e59aa4f0
ARG BUILD_INFO=dev
# the CLI encodes file names with the system locale; without UTF-8 any non-ASCII file name fails
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8 CONATUS_BUILD=$BUILD_INFO
RUN apt-get update \
 && apt-get install -y --no-install-recommends libbrotli1 libzstd1 libgmp10 libssl3 zlib1g ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && userdel -r ubuntu 2>/dev/null; groupadd -g 1000 bot && useradd -u 1000 -g bot -m -s /usr/sbin/nologin bot
COPY --from=node:22-slim /usr/local/bin/node /usr/local/bin/node
COPY docker/cli/bin/ /tmp/bin/
RUN if [ -f /tmp/bin/simplex-chat ]; then \
      echo "using provided binary"; mv /tmp/bin/simplex-chat /usr/local/bin/simplex-chat; \
    else \
      if [ "${SIMPLEX_VERSION}" = "latest" ]; then REL="latest/download"; else REL="download/v${SIMPLEX_VERSION}"; fi; \
      echo "downloading simplex-chat ${SIMPLEX_VERSION}"; \
      curl -fL --retry 3 -o /usr/local/bin/simplex-chat \
        "https://github.com/simplex-chat/simplex-chat/releases/${REL}/simplex-chat-ubuntu-24_04-x86_64"; \
      if [ -n "${SIMPLEX_SHA256}" ]; then echo "${SIMPLEX_SHA256}  /usr/local/bin/simplex-chat" | sha256sum -c - || { echo "checksum mismatch - refusing the binary"; exit 1; }; \
      else echo "WARNING: binary not verified (no SIMPLEX_SHA256 given)"; fi; \
    fi \
 && rm -rf /tmp/bin && chmod +x /usr/local/bin/simplex-chat && simplex-chat --version && node --version
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data && chown bot:bot /data /app
VOLUME /data
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
