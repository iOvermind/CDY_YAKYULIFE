# 一個 image 服務前端與 API。見 ADR 0007。
#
# 前端與伺服器端的引擎因此**永遠是同一份建置**——ADR 0002 說跨版本不保證重現，
# 這個架構讓那個風險不存在。

FROM node:24-alpine AS client
WORKDIR /build
COPY client/package*.json ./client/
RUN cd client && npm ci
COPY client ./client
# prebuild 的 changelog.mjs 從儲存庫根目錄讀這一份，產生遊戲裡的更新紀錄資料。
COPY CHANGELOG.md ./
RUN cd client && npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
# 伺服器直接 import client 的引擎原始碼，因此兩邊都要在 image 裡。
COPY server ./server
COPY client/src ./client/src
COPY client/tsconfig.json ./client/
COPY --from=client /build/client/dist ./public
ENV STATIC_DIR=/app/public
EXPOSE 8080
CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
