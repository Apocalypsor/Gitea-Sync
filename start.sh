#!/bin/sh

cd /usr/src/app && python sync.py

crond -f -L /dev/stdout
