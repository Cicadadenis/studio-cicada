FROM node:20-alpine AS build
WORKDIR /app

RUN apk add --no-cache python3 py3-pip

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    APP_ENV=production \
    DSL_SANDBOX_MODE=enforced
ARG CICADA_TG_PIN=0.3.5

RUN apk add --no-cache python3 py3-pip bubblewrap util-linux \
  && pip install --break-system-packages --no-cache-dir "cicada-tg==${CICADA_TG_PIN}"

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node server.mjs config.js email.mjs ./
COPY --chown=node:node public ./public
COPY --chown=node:node services ./services
COPY --chown=node:node core ./core
COPY --chown=node:node cicada ./cicada
RUN mkdir -p bots uploads/avatars && chown -R node:node /app

USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || 3001) + '/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
