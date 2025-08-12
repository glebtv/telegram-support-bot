FROM node:22-alpine

WORKDIR /bot

COPY ./package.json /bot/package.json
COPY ./package-lock.json /bot/package-lock.json

RUN apk update
RUN apk add wget python3 build-base
RUN npm install

COPY ./src /bot/src
COPY ./tsconfig.json /bot/tsconfig.json

CMD ["npm", "run", "prod", "--prefix", "/bot"]
