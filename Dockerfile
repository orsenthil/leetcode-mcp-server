FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --ignore-scripts

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/build ./build

RUN npm install --ignore-scripts --omit=dev

ENV LEETCODE_SITE=global \
    LEETCODE_TRANSPORT=http \
    LEETCODE_HTTP_HOST=0.0.0.0 \
    LEETCODE_HTTP_PORT=8080 \
    LEETCODE_HTTP_ENDPOINT=/mcp

EXPOSE 8080

CMD ["node", "build/index.js", "--transport", "http", "--host", "0.0.0.0", "--port", "8080", "--endpoint", "/mcp"]
