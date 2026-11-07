FROM node:22-slim AS build
WORKDIR /app
COPY webapp/package*.json webapp/
COPY server/package*.json server/
RUN npm ci --prefix webapp && npm ci --prefix server
COPY webapp webapp
COPY server server
RUN npm run build --prefix webapp && npm run build --prefix server && npm prune --omit=dev --prefix server

FROM node:22-slim
ENV NODE_ENV=production
ENV UPLOAD_DIR=/data/uploads
WORKDIR /app
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/webapp/dist webapp/dist
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 4020
CMD ["node", "server/dist/index.js"]
