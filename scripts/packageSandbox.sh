# Creates the self contained tarbal of the doctl deployer plugin used used as part of `doctl sls install.`
# Package should contaned a version of the deployer and all the production dependecies

TARBALL_NAME_PREFIX="doctl-sandbox"
TARBALL_NAME_SUFFIX="tar.gz"

VERSION=$(jq -r .version <package.json)
TARBALL_NAME="$TARBALL_NAME_PREFIX-$VERSION.$TARBALL_NAME_SUFFIX"

echo "- Building dosls version $VERSION"

echo "- Removing old artifacts"
rm -rf sandbox *.tar.gz digitalocean-functions-deployer-*.tgz node_modules

echo "- Building the simple deployer tarball"
npm install
npm pack

echo "- Moving artifacts to the sandbox folder"
mkdir sandbox
cp ./.sandbox/package.json ./sandbox/package.json
cp ./.sandbox/sandbox.js ./sandbox/sandbox.js

cd ./sandbox

if [[ "$OSTYPE" == "darwin"* ]]; then
  sed -i "" 's/${VERSION}/'$VERSION'/g' package.json
else 
    sed -i 's/${VERSION}/'$VERSION'/g' package.json
fi 

echo "$VERSION" > version
echo "- Installing production dependencies"
npm install --production

cd ..
echo "- Creating tar file $TARBALL_NAME"
tar czf "$TARBALL_NAME" sandbox
rm -rf sandbox

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
  UPLOADED=$($AWS s3api head-object --bucket "$TARGET_SPACE" --key "$TARBALL_NAME")
  if [ "$?" == "0" ]; then
    echo "$TARBALL_NAME has already been built and uploaded.  Skipping remaining steps."
    exit 0
  fi

  $AWS s3 cp "$TARBALL_NAME" "s3://$TARGET_SPACE/$TARBALL_NAME"
  $AWS s3api put-object-acl --bucket "$TARGET_SPACE" --key "$TARBALL_NAME" --acl public-read
fi