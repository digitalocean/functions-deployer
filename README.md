# DigitalOcean Functions deployer library (Node.js)

This repository contains an internal TypeScript library for deploying functions in DigitalOcean.  It is used by the `doctl serverless` deployer plugin and in remote builds.  It may eventually be used for a "deployer in the cloud" that renders the `doctl` plugin optional.

The contents were jumpstarted by migrating the original Nimbella deployer from `nimbella/nimbella-deployer`.  The commit history (and version) was preserved.  Thus, the first version sourced from this repo is a new major version, 5.0.0.

There are three artifacts that are derived from this source:

1.  A `nodejs` library for incorporation into other node-based tools.  Currently, this is uploaded to the DigitalOcean space `do-serverless-tools` in `nyc3` but it should eventually be published to `npm`.
2. The `doctl serverless` deployer-plugin.  Currently, this is built from (1) in the separate repo `digitalocean/doctl-sandbox-plugin`.
3. An install image for installing the deployer into container images (currently just runtime containers) with an outer shell called `dosls`.  We do not install a complete `doctl`into those images unless it is needed for another purpose.   In order for a `doctl` to be usable for driving the deployer, it must have a valid DigitalOcean access token stored in the file system.  We do not want to do that in container images.

Artifacts (1) and (3) are built by the script `internalRelease.sh` with no arguments.  That script is driven by a GitHub action on every push to the `main` branch.  It only builds the artifacts if the current version (in `package.json`) is not yet uploaded to the tools Space.  After building the artifacts, it uploads them as well.   So, new versions are "published" only on pushes to `main` with a new version number.

The `internalRelease.sh` script can also be run with a `--test` flag, in which case is builds the artifacts unconditionally but does not upload them.

### Testing changes locally

To test changes locally

```
npm install
npm run build
```
after which the deployer shell can be run as `/path/to/repo/bin/run`.  It is often convenient to make a symbolic link in your path pointing to that location (e.g. as `dosls`).   Then, you can test with

```
dosls deploy <projectDir>
dosls get-metadata <projectDir>
dosls watch <projectDir>
```

