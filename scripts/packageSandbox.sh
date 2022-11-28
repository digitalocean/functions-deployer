# Creates the self contained tarbal of the doctl deployer plugin used used as part of `doctl sls install.`
# Package should contaned a version of the deployer and all the production dependecies
# Args
# --upload (optional)        Uploads the file to Spaces as part of publishing
# --testing (optional)       For testing we symlink the "real" sandbox as viewed by the local doctl

# TODO: Parse arguments for uploading and testing

TARBALL_NAME_PREFIX="doctl-sandbox"
TARBALL_NAME_SUFFIX="tar.gz"

VERSION=$(jq -r .version <package.json)
TARBALL_NAME="$TARBALL_NAME_PREFIX-$VERSION.$TARBALL_NAME_SUFFIX"

echo "- Building dosls version $VERSION"

echo "- Removing old artifacts"
rm -rf sandbox *.tar.gz digitalocean-functions-deployer-*.tgz

echo "- Building the simple deployer tarball"
npm install --silent --no-progress
npm pack &>'/dev/null'

echo "- Moving artifacts to the sandbox folder"
mkdir sandbox
cp ./_sandbox/package.json ./sandbox/package.json
cp ./_sandbox/sandbox.js ./sandbox/sandbox.js

cd ./sandbox

sed -i "" 's/${VERSION}/'$VERSION'/g' package.json
echo "$VERSION" >version

echo "- Installing production dependencies"
npm install --production --silent --no-progress

cd ..
echo "- Creating tar file $TARBALL_NAME"
tar czf "$TARBALL_NAME" sandbox
rm -rf sandbox
