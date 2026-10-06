# Image for the e2e test runner (the bot itself ships in docker/Dockerfile).
FROM node:22-slim
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY test ./test
CMD ["node", "test/e2e/runner.js"]
