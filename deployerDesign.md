# DigitalOcean Functions Deployer -- Design Overview

## Use Cases

The _DigitalOcean Functions Deployer_ (hereafter, _the deployer_) has the general contract of taking _projects_ (arrangements of _files_ in some sort of medium, typically a file system) and turning them into collections of resources in a functions namespace (currently, functions, triggers, and bindings).  It's primary use cases are

- to be present as a plugin to `doctl` to support the `doctl sls [deploy | get-metadata | watch ]` commands
- to be present in the App Platform functions container image to support both detect and build
- to be present in every functions runtime to support remote build
   - for this purpose, there are always two instances of the deployer, one running as a _client_ (the previous two cases), the other running as a _service_.  The two are connected via functions in the `/nimbella/builder` package.
- the deployer is also employed as a library by the UI when creating functions initially via the functions editor

## Source control

The source to the deployer is OSS in the repo containing this document.  Up until recently, we used the deployer from legacy Nimbella, evolved just enough to suit DigitalOcean, and sourced from GitHub `nimbella/nimbella-deployer`.   The old repo will not be maintained going forward.   The new one was created by copying the old one and it inherits its commit history and tags (but not issues or releases).   The version of the deployer as of the copying was fixed at 5.0.0 (versions less than that are in the old repo).  Legacy Nimbella features not used in DigitalOcean have largely been removed.

## Executables

The deployer currently has two executable embodiments, **dosls** and _the doctl sandbox plugin_.  _Neither_ is intended for direct customer use.   Both are published internally as artifacts in `https://nyc3.digitaloceanspaces.com/<artifact-name>`.

### The doctl sandbox plugin

The doctl sandbox plugin is added to a `doctl` installation via `doctl sls install` and subsequently managed via `doctl sls upgrade` and `doctl sls uninstall`.   Its artifact name is `doctl-sandbox-${VERSION}.tar.gz`

For details on how it is generated you are referred to the scripts and GitHub actions in this repo.  For details on how `doctl sls install` handles the artifact and its resulting storage in the local file system, you are referred to the `doctl` repo.   

The key thing to know is that there is a constant `minServerlessVersion` in `doctl/do/serverless.go` which guides `doctl` to the correct version of the artifact.   Publishing a new version of the artifact has no effect on `doctl` releases until this constant is changed.

Once installed, the plugin appears to consumers of `doctl` as just part of the implementation of the `doctl serverless` command.   But, that command does many things that do not require the deployer, all of which are now implemented natively in the `doctl` codebase.  The deployer is used to provide only the `deploy`, `get-metadata`, and `watch` commands.  The way in which `doctl` invokes the plugin is "low tech": it just invokes it as a sub-process, capturing `stdout` and parsing it to obtain the output.

### The `dosls` executable

The `dosls` executable is designed for use in the functions runtimes only.  Its artifact name is `dosls-${VERSION}.tgz`.

For details on how `dosls` is installed in runtimes, you are referred to any of the runtime repos (OSS in `nimbella/openwhisk-runtime-[go|nodejs|php|python]`, branch `dev`).

The main motivation for `dosls` is to provide the `deploy` command in a packaging that does not require a DO access token at install time.  The `dosls` packaging is awkward to use in contexts where credentials have to be permanently stored.   The runtimes (as will be elaborated later) do not require this.   In other contexts (client machines, AP containers) the deployer should be used via `doctl` and the doctl sandbox plugin.

The original motivation for `dosls` has been superceded by recent changes that support installation without the need for a DO access token:

```
DOCKER_SANDBOX_INSTALL=true doctl serverless install`
```

Thus we could eventually eliminate the `dosls` special case even in the runtimes.  There is no rush to do this though.

## The Library API

The deployer is published as the `npm` package `@digitalocean/functions-deployer`.   Technically, its externals consist of everything exported by the `index.ts` source file, which is a pretty liberal list, motivated by historical usage that is quite likely not relevant any more.   In this writeup, I will selectively concentrate on parts of the API that are likely to be enduringly useful.   Most of this API is exported by the source files `main.ts` and `api.ts`.  Note that `main.ts` also contains a "main program" used by `dosls`.

### Top-level interface

This consists of the functions and types actively used by the doctl sandbox plugin and by `dosls main`.  They drive the deployer at somethng pretty close to "CLI level" but with some added discipline and support for output capture.

#### The `initializeAPI` function
  
Use of this function is not absolutely required but it is recommended so as to set the user agent string and suppress environment variables that might interfere with the proper operation of the OpenWhisk client library.  Code is in `api.ts`.

#### The `runCommand` function

This is the primary entry point to the deployer "commands" (`deploy`, `get-metadata`, `watch`, and `version`).  It accepts an input argument array and a logger object (the latter processes all the textual output from the deployer).  The first argument must be one of the four supported commands and the second argument (except in the case of `version`) must usually be a valid path to a project.  If the first argument is `deploy`, then the second argument may be a string starting with `slice:`, where the balance of the string is interpreted specially and is not a path to project.   This is a special case for use in runtimes and is covered below under "remote builds."

#### The `Logger` type

The `Logger` interface is the type of the second argument to `runCommand`.  It contains methods to handle output and abnormal conditions.

The output handling methods divide into line-oriented output (`log`), simple jSON (`logJSON`), tabular JSON (`logTable`) and compound output (`logOutput`).  

The error handling methods divide into simple error display (`displayError`), terminal error handling (`handleError`), and simple process exit (`exit`).  Not all implementations of `exit` actually `exit`.

Below the top-level interface, the deployer is designed not to leak errors, not to exit on its own, and not to write directly to the console.  Furthermore, it will generally delay output calls to the `Logger` until close to termination.  Warnings and progress messages that should be displayed earlier are handled by a distinct `Feedback` object defined by lower level APIs.

#### The `DefaultLogger` type

The `DefaultLogger` class implements `Logger` with methods that write to the console, throw errors, and exit.  It's used by the `dosls` main and by the doctl sandbox plugin for the `watch` command (which takes over the console).

#### The `CaptureLogger` type

The `CaptureLogger` class implements `Logger` with methods that store outputs in instance variables.  It's `handleError` method throws but its `exit` method is a no-op.  It's used by the doctl sandbox plugin for the `deploy` and `get-metadata` commands so that output can be post-processed by `doctl` itself.

### Phased Interface

The behavior of the deployer is organized into phases.

1. _Project reading_ covers the parsing of `project.yml`, the investigation of the directory/file structure of the project, and the merging of the two sources of information to form a unified view.
2. _Preparation_ covers identifying and validating the credentials to be used in the deployment.
3. _Building_ covers the conversion of the project's source artifacts into the actual artifact to be deployed (a text file or zip file).  This includes running customer provided scripts.
4. _Deploying_ covers the actual deployment of resources (functions, triggers, bindings) to the functions namespace.

The phased interface to the deployer allows these phases to be run in isolation.  The top-level interface simply runs all of them to completion in the appropriate order.

The phasing is somewhat perturbed when a _remote build_ is being initiated in a client deployer.  The remote build is started in the building phase, but its result is only checked for and retrieved in the deploying phase.

#### The `DeployStructure` type (and its dependents)

The phases of a deployment are linked through a data type called `DeployStructure` and its major dependents `PackageSpec`. `ActionSpec`, and `TriggerSpec` (as well as other dependent types). The contents are divided into

1. Fields that may be specified in `project.yml` without restriction.
2. Fields that may be specified in `project.yml` only when it was generated by a client deployer and sent to a deployer running in a runtime (the `slice` boolean will be `true` in this case).
3. Fields that may never be specified in `project.yml` but are added later during various deployment phases.

Note that, although the term `functions` is used externally, `actions` remains a valid alias for it and the term `actions` is still in use internally.   So, an `ActionSpec` specifies a function.

The project reading phase result is a `DeployStructure`.  That is also the input type of the remaining phases and the output type of the preparation and building phases.  Because any phase can discover errors, there is a distinguished `error` field in the structure.  A `DeployStructure` containing this field should not be passed to a subsequent phase.   Rather, the error should be converted directly into an error-carrying `DeployResponse` (see next section).

#### The `DeployResponse` type

The output of the final ("deploy") phase is a different type from its input and takes the form of a `DeployResponse`.  This structure succinctly summarizes the success and failures that occurred during the deployment.  Successes are only reported when the deploy phase was reached (all earlier phases succeeded).  If any earlier phase returned a `DeployStructure` with the `error` field set, that error will be converted to a degenerate `DeployResponse` reporting that error and no successes.

When the deployer is in a runtime (doing a remote build), the `DeployResponse` is converted to JSON and becomes the output of the remote build function, to be passed back to the client deployer.

When the deployer is the client deployer, the `DeployResponse` is further processed into the familiar human-readable results of a deployment.

#### The `readProject` function

The `readProject` function implements the project reading phase.  It accepts these arguments:

- the project path (`string`)
- the path to the runtime environment file (`string`, may be falsey)
- the path to the build time environment file (`string`, may be falsey)
- the includer (type `Includer` explained below)
- the remote build flag (`boolean`)
- the feedback object (type `Feedback` explained below, may be omitted)
- the noTriggers flag (`boolean`, defaults to false if omitted)

The purpose of the `noTriggers` flag is to cause the presence of triggers in `project.yml` to be treated as an error.  This is intended to be used by App Platform until support is in place for triggers there.  It is surfaced on both the `deploy` and `get-metadata` commands in both `doctl` and `dosls`.

Note that the `get-metadata` command runs `readProject` and then does little else, returning the resulting `DeployStructure` as JSON.

During the project reading phase, fields called `build` are set in each `ActionSpec` and a field called `libBuild` is set in the `DeployStructure`.  These result from "calling ahead" into utility functions of the building phase after analyzing the contents of the project.  The decision as to which builds will execute remotely is made at this time (explaining why the remote build flag is needed).

##### The `Includer` type

The `Includer` type is a convenient internal representation of the information provided on the command line via the `--include` and `--exclude` flags.   It is used to filter parts of the project during deployment so that only the intended parts are processed.  The `makeIncluder` utility function converts the pair of flags into this object type.

##### The `Feedback` type

The `Feedback` interface is used by the deployer to provide information that (ideally) should be displayed in real time rather than being provided at the end.  It has two methods, `progress` and `warn`.  The former is used for progress messages and the latter for warnings.  

The `LoggerFeedback` implementation simply wraps a `Logger` in a `Feedback` and is mostly what is used in practice.  The `LoggerFeedback` has a mutable boolean property `warnOnly` which suppresses `progress` messages.   This is used when remote builds are being performed in a runtime.  The progress messages will not be seen in real time anyway and will just clutter the build transcript so they are suppressed.

#### The `prepareToDeploy` function

The `prepareToDeploy` function accepts a `DeployStructure`, an optional `Credentials` object, and a required `Flags` object.  The `DeployStructure` also has fields `credentials` and `flags` which are filled in by the end of the phase.  The phase is also responsible for noting the special case of a remote build running in a runtime (`slice==true`) and taking the credentials strictly from the `DeployStructure`.  Otherwise, it processes the low-level credential flags and the contents of the credential store prior to actually opening an OpenWhisk client handle.  A call to the controller is always made, either to find out the namespace associated with the credentials or to validate that the recorded namespace is still the one associated with the crednetials.  The client handle itself is stored in the `DeployStructure`.

##### The `Credentials` type

The `Credentials` type models a set of credentials for a namespace.  At one time, in legacy Nimbella, this set included several kinds of credentials besides OpenWhisk ones (for web deployment, GitHub, Commander, Postman, etc).   Now, the type simply summarizes the OpenWhisk credentials plus the DO API token.  At present, the DO API token is used only to deploy triggers.  Over time, it is expected to be used for more and more of the OpenWhisk CRUD API until, eventually, the OpenWhisk credentials will not need to be stored locally.

##### The `Flags` type

The `Flags` type summarizes the flags that can be specified on the command line, both documented ones, and specialized ones that are primarily for internal use.

#### The `buildProject` function

The `buildProject` function takes a `DeployStructure` as input and returns one as output.  It assumes that the `build` and `libBuild` fields were previously filled in, so there is a kind of "plan" for what builds must be run.  However, the actual running of those builds (if local) or the initiation of those builds (if remote) takes place in the scope of this function.

The term "building" is a bit overloaded in this context.  Please note the following.

1.  The main source file for the building phase is `finder-builder.ts` and that name is not an accident.  The processing of `.include` and `.ignore` directives (that is, "finding" all the artifacts that should be part of the deployment and assembling them into a zip) is part of the "building" phase.
2. There is thus the notion of a "real" build (as determined by the utility function `isRealBuild`).  A real build is defined as something that requires a subprocess and an work area in the file system.  So anything driven by `build.sh` or `package.json` is "real" but the process of assembling files and directories into a zip is not.
3. Only "real" builds will execute remotely.  So, even if the remote build flag is set, some "builds" (the ones that just "find" things) will still execute locally and the deploy step will also execute locally.

The `buildProject` function does not wait for the completion of remote builds.   Rather, the activation ids of the builder functions that are running those builds are recorded (field `buildResult` of `ActionSpec`) for interrogation during the deploy phase.  There is no activation id for the lib build because there is no independent initiation of a builder function for it.  Rather, the lib build will be run in the remote process prior to (or instead of) the function build and the remote process doesn't return a result until the function is actualy deployed.

#### The `deploy` function

The `deploy` function has a `DeployStructure` as its single input argument and returns a `DeployResponse`.  At input, the contents of each function has been determined, so deployment primarily consists of driving remote APIs to accompish resource creation.

There are a number of more specialized things that happen in this phase, which are covered under internals.

#### Multi-phase convenience functions

The phased interface also has a number of convenience functions that drive more than one phase.

##### The `readAndPrepare` function

This function drives the project reading phase followed by the preparation phase.  It does a bit more than just sequencing the phases because it takes care of building the `Includer` object and splitting up the flags for the `readProject` function, thus its interface is simplified.

Its inputs are the project path, the `Credentials`, the `Flags` and an optional `Feedback` object.  Its result is the result of the preparation phase.

##### The `readPrepareAndBuild` and `deployProject` functions

These simply drive the first three or all four phases in succession.  

## Internals

Watch this space.