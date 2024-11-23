#!/bin/bash
set -e
npm run build
host=slayer.marioslab.io
host_dir=/home/badlogic/progfeeds.mariozechner.at

rsync -avz --exclude node_modules --exclude .git --exclude data --exclude docker/data ./ $host:$host_dir

echo "Publishing client & server"
ssh -t $host "cd $host_dir && export PROGFEEDS_ACCOUNT=$PROGFEEDS_ACCOUNT && export PROGFEEDS_PASSWORD=$PROGFEEDS_PASSWORD && ./docker/control.sh stop && ./docker/control.sh start && ./docker/control.sh logs"
