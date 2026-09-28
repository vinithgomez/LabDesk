# LabDesk API. Build context: server/.
FROM node:22-alpine AS build
WORKDIR /app
# Prisma's query engine links against OpenSSL.
RUN apk add --no-cache openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
# postinstall runs `prisma generate` for this image's platform.
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
# node_modules keeps the Prisma CLI (a dev dependency) for `migrate deploy`.
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist
COPY docker-entrypoint.sh ./
USER node
EXPOSE 4000
ENTRYPOINT ["sh", "./docker-entrypoint.sh"]
