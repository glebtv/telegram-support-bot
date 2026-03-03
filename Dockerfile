FROM node:22.22.0-alpine

WORKDIR /bot

COPY ./package.json /bot/package.json
COPY ./package-lock.json /bot/package-lock.json

RUN apk update && apk add --no-cache wget python3 build-base

RUN npm install --fetch-retry-maxtimeout=120000 --fetch-timeout=300000

COPY ./src /bot/src
COPY ./tsconfig.json /bot/tsconfig.json

CMD ["npm", "run", "prod", "--prefix", "/bot"]
