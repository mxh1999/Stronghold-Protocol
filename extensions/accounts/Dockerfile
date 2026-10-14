ARG GAME_IMAGE=stronghold-protocol
FROM ${GAME_IMAGE}
USER root
COPY --chown=node:node extensions/accounts/start.mjs extensions/accounts/admin.mjs extensions/accounts/package.json /app/extensions/accounts/
COPY --chown=node:node extensions/accounts/server /app/extensions/accounts/server
COPY --chown=node:node extensions/accounts/public /app/extensions/accounts/public
RUN mkdir -p /app/account-data && chown node:node /app/account-data
ENV SP_ACCOUNT_DATA=/app/account-data HOST=0.0.0.0
USER node
CMD ["node", "extensions/accounts/start.mjs"]
