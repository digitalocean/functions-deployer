#!/bin/bash

# Creates and uploads a build of the deployer for incorporation into other DigitalOcean tools.
# With the --test flag, creates artifacts without uploading.  

# Two artifacts are created / uploaded.
# 1. A tarball resulting from 'npm pack' and suitable for installation as a dependency.
# 2. A complete installation tarball for ubuntu (suitable for incorporating dosls into runtimes).

# Change these variables on changes to the space we are uploading to or naming conventions within it
TARGET_SPACE=do-serverless-tools
DO_ENDPOINT=nyc3.digitaloceanspaces.com
SPACE_URL="https://$TARGET_SPACE.$DO_ENDPOINT"
TARBALL_NAME_PREFIX="digitalocean-functions-deployer"

# Change this variable when local setup for s3 CLI access changes
# This assumes the developer has a profile 'do' with the appropriate access keys for
# carrying out this operaiton.
AWS="aws --profile do --endpoint https://$DO_ENDPOINT"

# This node download URL should match what doctl sls install would install for linux amd
nodeVersion="v16.13.0"
nodeDir="node-${nodeVersion}-linux-x64"
NODE_DOWNLOAD=https://nodejs.org/dist/${nodeVersion}/${nodeDir}.tar.gz

TESTING=
if [ "$1" == "--test" ]; then
  TESTING=true
elif [ -n "$2" ]; then
  echo "unexpected argument: $1"
  exit 1
fi

SELFDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $SELFDIR

echo "Determining the version"
VERSION=$(jq -r .version < package.json)
echo "New version is $VERSION"

# Name the tarballs
TARBALL_NAME="$TARBALL_NAME_PREFIX-$VERSION.tgz"
FAT_TARBALL_NAME="dosls-$VERSION.tgz"
echo "The dependency tarball is $TARBALL_NAME"
echo "The complete install tarball for Linux is $FAT_TARBALL_NAME"

if [ -z "$TESTING" ]; then
  echo "Checking whether this version is already uploaded"
  UPLOADED=$($AWS s3api head-object --bucket "$TARGET_SPACE" --key "$TARBALL_NAME")
  if [ "$?" == "0" ]; then
    echo "$TARBALL_NAME has already been built and uploaded.  Skipping remaining steps."
    exit 0
  fi
fi

set -e

echo "Removing old artifacts"
rm -rf lib node_modules *.tgz

echo "Ensuring a full install"
npm install

echo "Building the simple tarball"
npm pack

if [ -z "$TESTING" ]; then
  echo "Uploading the simple tarball"
  $AWS s3 cp "$TARBALL_NAME" "s3://$TARGET_SPACE/$TARBALL_NAME"
  $AWS s3api put-object-acl --bucket "$TARGET_SPACE" --key "$TARBALL_NAME" --acl public-read
fi

echo "Creating node_modules for the full install"
rm -fr dosls
mkdir dosls
cd dosls
cp ../package.json .
npm install --production ../$TARBALL_NAME
rm *.json

echo "Downloading node binary suitable for runtime use"
curl -L $NODE_DOWNLOAD | tar xzf -
mv ${nodeDir}/bin/node .
rm -fr ${nodeDir}

echo "Adding bootstrap"
cp ../bootstrap .

echo "Making the installation tarball (linux amd64 only)"
cd ..
tar czf "$FAT_TARBALL_NAME" dosls

if [ -n "$TESTING" ]; then
  echo "Test build is complete"
  exit
fi

echo "Uploading the installation tarball"
$AWS s3 cp "$FAT_TARBALL_NAME" "s3://$TARGET_SPACE/$FAT_TARBALL_NAME"
$AWS s3api put-object-acl --bucket "$TARGET_SPACE" --key "$FAT_TARBALL_NAME" --acl public-read
