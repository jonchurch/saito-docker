FROM node:9-jessie

RUN apt-get update
RUN apt-get install g++ make

COPY ./ /saito
WORKDIR /saito/extras/sparsehash/sparsehash

RUN ./configure && make && make install

WORKDIR /saito

RUN npm install
RUN cd ./lib && ./compile

CMD node ./lib/start.js
# ENTRYPOINT /bin/sh

EXPOSE 12101




