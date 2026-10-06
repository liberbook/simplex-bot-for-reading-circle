# Security

## Reporting a vulnerability

Please report security issues privately through GitHub's
[security advisories](https://github.com/liberbook/simplex-bot-for-reading-circle/security/advisories/new)
rather than in a public issue.

## Running the bot safely

- The `simplex-chat` WebSocket API has no authentication. Keep it on
  `127.0.0.1` (the default) and never expose port 5225; the Docker image runs
  the CLI and the bot in one container for that reason.
- The bot runs as an unprivileged user; the CLI binary is checked against a
  pinned SHA-256 when the image is built.
- `deploy/data/` holds the chat database (the bot's private keys) and the
  archive - back it up and keep it out of version control.
