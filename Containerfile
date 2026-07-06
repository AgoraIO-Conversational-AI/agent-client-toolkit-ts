FROM node:22-alpine AS web-demo-build

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY tsconfig.json tsconfig.base.json ./
COPY src ./src
COPY packages ./packages
COPY apps/web-demo ./apps/web-demo

RUN pnpm install --frozen-lockfile
RUN pnpm --filter agora-agent-client-toolkit-web-demo run build
RUN pnpm --filter agora-agent-client-toolkit-web-demo deploy --legacy --prod /tmp/web-demo-runtime

FROM nginx:1.27-alpine

RUN apk add --no-cache nodejs

WORKDIR /app

COPY --from=web-demo-build /workspace/apps/web-demo/dist /usr/share/nginx/html
COPY --from=web-demo-build /tmp/web-demo-runtime/node_modules ./node_modules
COPY --from=web-demo-build /tmp/web-demo-runtime/package.json ./package.json
COPY --from=web-demo-build /workspace/apps/web-demo/server ./server

COPY apps/web-demo/deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web-demo/deploy/start-container.sh /usr/local/bin/start-container.sh

ENV WEB_DEMO_SERVER_HOST=127.0.0.1
ENV WEB_DEMO_SERVER_PORT=8788
ENV NODE_ENV=production

EXPOSE 80

CMD ["/usr/local/bin/start-container.sh"]
