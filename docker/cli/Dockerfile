# simplex-chat terminal CLI run headless as a WebSocket server (one process
# per chat participant). Ubuntu 24.04 matches the glibc of the release build.
#
# The binary comes from bin/simplex-chat if present (see fetch-cli.sh), else
# it is downloaded from GitHub releases during the build: SIMPLEX_VERSION is a
# release version (7.0.2) or "latest". Update with scripts/update-cli.sh.
FROM ubuntu:24.04
ARG SIMPLEX_VERSION=7.0.2
ARG SIMPLEX_SHA256=895fb14cfaa662d1c0947f2f871141fc89680fe3e70bff64c366cbe9e59aa4f0
# the CLI encodes file names with the system locale; without UTF-8 any non-ASCII
# file name (e.g. Cyrillic) fails with "cannot encode character"
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8
RUN apt-get update \
 && apt-get install -y --no-install-recommends libbrotli1 libzstd1 libgmp10 libssl3 zlib1g ca-certificates socat curl \
 && rm -rf /var/lib/apt/lists/*
COPY bin/ /tmp/bin/
RUN if [ -f /tmp/bin/simplex-chat ]; then \
      echo "using provided binary"; mv /tmp/bin/simplex-chat /usr/local/bin/simplex-chat; \
    else \
      if [ "${SIMPLEX_VERSION}" = "latest" ]; then REL="latest/download"; else REL="download/v${SIMPLEX_VERSION}"; fi; \
      echo "downloading simplex-chat ${SIMPLEX_VERSION}"; \
      curl -fL --retry 3 -o /usr/local/bin/simplex-chat \
        "https://github.com/simplex-chat/simplex-chat/releases/${REL}/simplex-chat-ubuntu-24_04-x86_64"; \
      if [ -n "${SIMPLEX_SHA256}" ]; then echo "${SIMPLEX_SHA256}  /usr/local/bin/simplex-chat" | sha256sum -c - || exit 1; fi; \
    fi \
 && rm -rf /tmp/bin && chmod +x /usr/local/bin/simplex-chat && simplex-chat --version
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh && mkdir -p /data/db /data/files /data/tmp
EXPOSE 5225
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
