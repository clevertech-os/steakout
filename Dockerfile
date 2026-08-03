FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/* \
  && npm ci

COPY client ./client
COPY server ./server

# Client bake-time env (Vite). Production defaults: mainnet + public origin for Pay QR.
ARG VITE_NIMIQ_NETWORK=mainnet
ARG VITE_PUBLIC_APP_URL=https://steakout-production.up.railway.app
ENV VITE_NIMIQ_NETWORK=$VITE_NIMIQ_NETWORK
ENV VITE_PUBLIC_APP_URL=$VITE_PUBLIC_APP_URL

RUN npm run build

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev

COPY --from=build /app/client/dist ./client/dist
COPY --from=build /app/server/src ./server/src

RUN mkdir -p /data

EXPOSE 3000
CMD ["node", "--import", "tsx", "server/src/index.ts"]
