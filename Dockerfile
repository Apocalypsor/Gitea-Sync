FROM python:3.9-alpine

WORKDIR /usr/src/app

COPY . .

RUN apk add --no-cache gcc musl-dev libffi-dev \
    && pip install pipenv \
    && pipenv requirements > requirements.txt \
    && pip install -r requirements.txt \
    && touch /usr/src/app/sync.log \
    && chmod +x /usr/src/app/start.sh

RUN apk add --no-cache busybox-suid openrc

COPY crontab.txt /etc/crontabs/root

ENTRYPOINT /usr/src/app/start.sh
