#!/bin/bash

# Obtains the latest version of doctl for the os and arch of the machine it is running on.
# Assumes running under bash even on windows.

# The following is heuristic and incomplete.  A better way would be welcome.
which uname >/dev/null || (echo "Cannot run on native windows" && exit 1)

set -e

SUFFIX="tar.gz"
UOS=$(uname -s)
UNPACK="tar xzf"
if [[ "$UOS" == *Linux* ]]; then
  OS=linux
elif [ "$UOS" == Darwin ]; then
  OS=darwin
else
  OS=windows
  UNPACK=unzip
  SUFFIX=zip
fi

UARCH=$(uname -m)
if [ $UARCH == x86_64 ]; then
  ARCH=amd64
elif [[ $UARCH == *386* ]]; then
  ARCH=386
else
  ARCH=$UARCH
fi

# Gets the latest release of doclt using the GitHub API
# and saves it in bin directory.
echo  "$(curl "https://api.github.com/repos/digitalocean/doctl/releases/latest")"
VERSION=$(curl --silent "https://api.github.com/repos/digitalocean/doctl/releases/latest" | jq -r .tag_name | sed 's/v//')
NAME="doctl-$VERSION-$OS-$ARCH.$SUFFIX"
DOWNLOAD_URL="https://github.com/digitalocean/doctl/releases/download/v$VERSION/$NAME"

echo "- Downloading from $DOWNLOAD_URL"
[ -d bin ] || mkdir bin
curl -LO --silent "$DOWNLOAD_URL"
$UNPACK "$NAME" -C bin
rm "$NAME"
echo -e "\xE2\x9C\x94 Downloaded doctl version v$VERSION"
