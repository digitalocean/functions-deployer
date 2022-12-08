#!/bin/bash

# Creates and uploads a build of the deployer for incorporation into other DigitalOcean tools.
# The packaged dosls tar will include the required version of the node runtime. 

# This node download URL should match what doctl sls install would install for linux amd
nodeVersion="v16.13.0"
nodeDir="node-${nodeVersion}-linux-x64"
NODE_DOWNLOAD_URL=https://nodejs.org/dist/${nodeVersion}/${nodeDir}.tar.gz

VERSION=$(jq -r .version <package.json)
echo "- Building dosls version $VERSION"

FAT_TARBALL_NAME="dosls-$VERSION.tgz"
TARBALL_NAME="digitalocean-functions-deployer-$VERSION.tgz"

echo "- Removing old artifacts"
rm -rf lib node_modules *.tgz dosls

echo "- Ensuring a full install"
npm install --silent --no-progress

echo "- Building the simple tarball"
npm pack

echo "- Creating node_modules for the full install"
mkdir dosls
cd dosls
cp ../package.json .
npm install --production --silent --no-progress ../$TARBALL_NAME
rm *.json

echo "- Downloading node binary suitable for runtime use"
curl -L --silent $NODE_DOWNLOAD_URL | tar xzf -
mv ${nodeDir}/bin/node .
rm -fr ${nodeDir}

echo "- Adding bootstrap"
cp ../bootstrap .

echo "- Making the installation tarball (linux amd64 only)"
cd ..
tar czf "$FAT_TARBALL_NAME" dosls

# Uploads the file to Spaces if not testing.
if [ -z "$TESTING" ]; then
  # Change these variables on changes to the space we are uploading to or naming conventions within it
  TARGET_SPACE=do-serverless-tools
  DO_ENDPOINT=nyc3.digitaloceanspaces.com
  SPACE_URL="https://$TARGET_SPACE.$DO_ENDPOINT"
  
  # Change this variable when local setup for s3 CLI access changes
  # This assumes the developer has a profile 'do' with the appropriate access keys for
  # carrying out this operaiton.
  AWS="aws --profile do --endpoint https://$DO_ENDPOINT"

  echo "- Checking whether this version is already uploaded"
  UPLOADED=$($AWS s3api head-object --bucket "$TARGET_SPACE" --key "$FAT_TARBALL_NAME")
  if [ "$?" == "0" ]; then
    echo "$FAT_TARBALL_NAME has already been built and uploaded.  Skipping remaining steps."
    exit 0
  fi

  echo "- Uploading the installation tarball"
  $AWS s3 cp "$FAT_TARBALL_NAME" "s3://$TARGET_SPACE/$FAT_TARBALL_NAME"
  $AWS s3api put-object-acl --bucket "$TARGET_SPACE" --key "$FAT_TARBALL_NAME" --acl public-read
fi
