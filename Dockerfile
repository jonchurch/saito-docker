FROM node:9-jessie

RUN apt-get update
RUN apt-get install g++ make

COPY ./ /saito
WORKDIR /saito/extras/sparsehash/sparsehash

RUN ./configure && make && make install

WORKDIR /saito

RUN npm install
RUN node ./lib/start.js

EXPOSE 12101




