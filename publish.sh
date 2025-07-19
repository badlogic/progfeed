#!/bin/bash
set -e
npm run build
host=slayer.marioslab.io
host_dir=/home/badlogic/progfeeds.mariozechner.at

# Create .env file locally in docker directory
cat > docker/.env << EOF
PROGFEEDS_ACCOUNT=$PROGFEEDS_ACCOUNT
PROGFEEDS_PASSWORD=$PROGFEEDS_PASSWORD
EOF

rsync -avz --exclude node_modules --exclude .git --exclude data --exclude docker/data ./ $host:$host_dir

if [ "$1" == "server" ]; then
    echo "Publishing client & server"
    ssh -t $host "cd $host_dir && ./docker/control.sh stop && ./docker/control.sh start && ./docker/control.sh logs"
else
    echo "Publishing client only"
fi