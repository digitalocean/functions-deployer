#!/bin/bash

# Creates and uploads a build of the deployer for incorporation into other DigitalOcean tools.

# Change these variables on changes to the space we are uploading to or naming conventions within it
TARGET_SPACE=do-serverless-tools
DO_ENDPOINT=nyc3.digitaloceanspaces.com
SPACE_URL="https://$TARGET_SPACE.$DO_ENDPOINT"
TARBALL_NAME_PREFIX="digitalocean-functions-deployer"
TARBALL_NAME_SUFFIX="tgz"

# Change this variable when local setup for s3 CLI access changes
# This assumes the developer has a profile 'do' with the appropriate access keys for
# carrying out this operaiton.
AWS="aws --profile do --endpoint https://$DO_ENDPOINT"

SELFDIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd $SELFDIR

echo "Determining the version"
VERSION=$(jq -r .version < package.json)
echo "New version is $VERSION"
TARBALL_NAME="$TARBALL_NAME_PREFIX-$VERSION.$TARBALL_NAME_SUFFIX"
echo "New tarball name is $TARBALL_NAME"

echo "Checking whether the new (?) tarball is already uploaded"
UPLOADED=$($AWS s3api head-object --bucket "$TARGET_SPACE" --key "$TARBALL_NAME")
if [ "$?" == "0" ]; then
  echo "$TARBALL_NAME has already been built and uploaded.  Skipping remaining steps."
  exit 0
fi

set -e

echo "Removing old artifacts"
rm -rf lib node_modules *.tgz

echo "Ensuring a full install"
npm install

echo "Building the tarball"
npm pack

echo "Uploading"
$AWS s3 cp "$TARBALL_NAME" "s3://$TARGET_SPACE/$TARBALL_NAME"
$AWS s3api put-object-acl --bucket "$TARGET_SPACE" --key "$TARBALL_NAME" --acl public-read
