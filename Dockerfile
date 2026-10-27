# Runs Spotlight as a single long-lived container. Works on Cloudflare Containers, Fly, Render, Azure, etc.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/tmp/spotlight

# Dependencies first so this layer is cached between code changes
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p /tmp/spotlight && chown -R node:node /app /tmp/spotlight
USER node

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# ADMIN_PASSWORD (and ideally SESSION_SECRET) must be supplied by the platform; everything else is in .env
CMD ["node", "--env-file-if-exists=.env", "--env-file-if-exists=.env.local", "server.js"]
