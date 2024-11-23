#!/bin/bash
dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null && pwd )"
pushd $dir/.. > /dev/null

if [ -z "$DEV" ]; then
echo "Starting server in prod mode"
	node --enable-source-maps build/feed-server.js
else
    echo "Starting server in dev mode"
	node --watch --enable-source-maps  build/feed-server.js
fi