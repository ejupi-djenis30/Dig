FROM node:22.23.1-alpine

WORKDIR /app

COPY --chown=node:node package.json LICENSE README.md PRIVACY.md SECURITY.md CHANGELOG.md ./
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
COPY --chown=node:node site ./site
COPY --chown=node:node scripts/serve-app.mjs ./scripts/serve-app.mjs

USER node

ENV DIG_HOST=0.0.0.0 \
    DIG_PORT=4175 \
    DIG_MODE=hosted

EXPOSE 4175

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "const port=process.env.DIG_PORT||'4175';fetch('http://127.0.0.1:'+port+'/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "scripts/serve-app.mjs"]
