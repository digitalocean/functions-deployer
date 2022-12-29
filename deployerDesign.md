# DigitalOcean Functions Deployer -- Design Overview

## Use Cases

The _DigitalOcean Functions Deployer_ (hereafter, _the deployer_) has the general contract of taking _projects_ (arrangements of _files_ in some sort of medium, typically a file system) and turning them into collections of resources in a functions namespace (currently, functions, triggers, and bindings).  It's primary use cases are

- to be present as a plugin to `doctl` to support the `doctl sls [deploy | get-metadata | watch ]` commands
- to be present in the App Platform functions container image to support both detect and build
- to be present in every functions runtime to support [remote build](#Remote-Build)
- the deployer is also employed as a library by the UI when creating functions initially via the functions editor

### Remote Build

Because remote build is an important use case and requires some additional explanation, we elaborate on it here.

In a remote build, there are multiple instances of the deployer running.  The initiating instance (_the client deployer_) is running on a client machine or in an AP container.  It reads the entire project and determines which functions will be built locally and which remotely.  For each function that is to be built remotely, it creates a _project slice_ for that function.  A project slice is a project that contains just one function.  The slice is always a subset of the original project.  It is initially in the form of a zip "file" in memory.  For each project slice, the client deployer does the following.

1. It invokes an API (currently the system action `/nimbella/builder/getUploadUrl`) to obtain a URL for uploading the slice to a bucket (as a zip object).
2. It uploads the slice.
3. It invokes a different API (currently a runtime-specific system action in `/nimbella/builder`) to complete the build and deploy steps remotely for the selected function.

The builder action just referred to in step (3) will invoke a second instance of the deployer (_the slice deployer_) inside the appropriate functions runtime.  The selected runtime is always that which will be used to invoke the function.  A special argument form tells the deployer that it is to run as a slice deployer and gives the coordinates where the slice object will be found in the appropriate bucket.  The slice deployer fetches the slice and unzips into the runtime file system, after which it pretty much deploys it as if it were a simple project.

Details of this process will appear in various other sections of this document as appropriate.

## Source control

The source to the deployer is OSS in the repo containing this document.  Up until recently, we used the deployer from legacy Nimbella, evolved just enough to suit DigitalOcean, and sourced from GitHub `nimbella/nimbella-deployer`.   The old repo will not be maintained going forward.   The new one was created by copying the old one and it inherits its commit history and tags (but not issues or releases).   The version of the deployer as of the copying was fixed at 5.0.0 (versions less than that are in the old repo).  Legacy Nimbella features not used in DigitalOcean have largely been removed.

## Executables

The deployer currently has two executable embodiments, **dosls** and _the doctl sandbox plugin_.  _Neither_ is intended for direct customer use.   Both are published internally as artifacts in `https://nyc3.digitaloceanspaces.com/<artifact-name>`.

### The doctl sandbox plugin

The doctl sandbox plugin is added to a `doctl` installation via `doctl sls install` and subsequently managed via `doctl sls upgrade` and `doctl sls uninstall`.   Its artifact name is `doctl-sandbox-${VERSION}.tar.gz`

For details on how it is generated you are referred to the [scripts](https://github.com/digitalocean/functions-deployer/tree/main/scripts) and [GitHub actions](https://github.com/digitalocean/functions-deployer/tree/main/.github/workflows) in this repo.  For details on how `doctl sls install` handles the artifact and its resulting storage in the local file system, you are referred to the `doctl` repo.   

The key thing to know is that there is a constant `minServerlessVersion` in `doctl/do/serverless.go` which guides `doctl` to the correct version of the artifact.   Publishing a new version of the artifact has no effect on `doctl` releases until this constant is changed.

Once installed, the plugin appears to consumers of `doctl` as just part of the implementation of the `doctl serverless` command.   But, that command does many things that do not require the deployer, all of which are now implemented natively in the `doctl` codebase.  The deployer is used to provide only the `deploy`, `get-metadata`, and `watch` commands.  The way in which `doctl` invokes the plugin is "low tech": it just invokes it as a sub-process, capturing `stdout` and parsing it to obtain the output.

### The `dosls` executable

The `dosls` executable is designed for use in the functions runtimes only.  Its artifact name is `dosls-${VERSION}.tgz`.

For details on how `dosls` is installed in runtimes, you are referred to any of the runtime repos (OSS in `nimbella/openwhisk-runtime-[go|nodejs|php|python]`, branch `dev`).

The motivation for `dosls` was to provide the `deploy` command in a packaging that does not require a DO access token at install time.  Otherwise, the `dosls` packaging is awkward to use in contexts where credentials can readily be stored in the local file system.   The runtimes do not employ credentials stored in this fashion.   In other contexts (client machines, AP containers) the deployer should be used via `doctl` and the doctl sandbox plugin.

The original motivation for `dosls` has been superceded by recent changes that support installation without the need for a DO access token:

```
DOCKER_SANDBOX_INSTALL=true doctl serverless install
```

Thus we could eventually eliminate the `dosls` special case even in the runtimes.  There is no rush to do this though.

## The Library API

The deployer is also published as the `npm` package `@digitalocean/functions-deployer`.   Technically, its externals consist of everything exported by the [`index.ts`](https://github.com/digitalocean/functions-deployer/tree/main/src/index.ts) source file, which is a pretty liberal list, motivated by historical usage that is quite likely not relevant any more.   In this writeup, I will selectively concentrate on parts of the API that are likely to be enduringly useful.   Most of this API is exported by the source files [`main.ts`](https://github.com/digitalocean/functions-deployer/tree/main/src/main.ts) and [`api.ts`](https://github.com/digitalocean/functions-deployer/tree/main/src/api.ts).  Note that `main.ts` also contains a "main program" used by `dosls`.

### Top-level interface

This consists of the functions and types actively used by the doctl sandbox plugin and by `dosls main`.  They drive the deployer at somethng pretty close to "CLI level" but with some added discipline and support for output capture.

#### The `initializeAPI` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/api.ts#L50)
  
Use of this function is not absolutely required but it is recommended so as to set the user agent string and suppress environment variables that might interfere with the proper operation of the OpenWhisk client library.

#### The `runCommand` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/main.ts#L200)

This is the primary entry point to the deployer "commands" (`deploy`, `get-metadata`, `watch`, and `version`).  It accepts an input argument array and a logger object (the latter processes all the textual output from the deployer).  The first argument must be one of the four supported commands and the second argument (except in the case of `version`) must usually be a valid path to a project.  

If the first argument is `deploy`, then the second argument _may_ be a string starting with `slice:`, where the balance of the string is interpreted specially and is not a path to project.   This is syntax is reserved for use by a builder action when invoking the deployer as a slice deployer in a runtime (as discussed under [remote build](#Remote-Build)).

#### The `Logger` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/main.ts#L40)

The `Logger` interface is the type of the second argument to `runCommand`.  It contains methods to handle output and abnormal conditions.

The output handling methods divide into line-oriented output (`log`), simple jSON (`logJSON`), tabular JSON (`logTable`) and compound output (`logOutput`).  

The error handling methods divide into simple error display (`displayError`), terminal error handling (`handleError`), and simple process exit (`exit`).  Not all implementations of `exit` actually `exit`.

Below the top-level interface, the deployer is designed not to leak errors, not to exit on its own, and not to write directly to the console.  Furthermore, it does not use the `Logger` (only the top-level API uses it) but rather returns all normal information as part of the result.  Warnings and progress messages that should be displayed prior to termination are handled by a distinct `Feedback` object defined by lower level APIs.

#### The `DefaultLogger` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/main.ts#L55)

The `DefaultLogger` class implements `Logger` with methods that write to the console, throw errors, and exit.  It's used by the `dosls` main and by the doctl sandbox plugin for the `watch` command (which takes over the console).

#### The `CaptureLogger` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/main.ts#L98)

The `CaptureLogger` class implements `Logger` with methods that store outputs in instance variables.  It's `handleError` method throws but its `exit` method is a no-op.  It's used by the doctl sandbox plugin for the `deploy` and `get-metadata` commands so that output can be post-processed by `doctl` itself.

### Phased Interface

The behavior of the deployer is organized into phases.

1. _Project reading_ covers the parsing of `project.yml`, the investigation of the directory/file structure of the project, and the merging of the two sources of information to form a unified view.
2. _Preparation_ covers identifying and validating the credentials to be used in the deployment.
3. _Building_ covers the conversion of the project's source artifacts into the actual artifact to be deployed (a text file or zip file).  This includes running customer provided scripts.
4. _Deploying_ covers the actual deployment of resources (functions, triggers, bindings) to the functions namespace.

The phased interface to the deployer allows these phases to be run in isolation.  The top-level interface simply runs all of them to completion in the appropriate order.

The phasing is somewhat perturbed when a [remote build](#Remote-Build) is being initiated in a client deployer.  The remote build is started in the building phase, but its result is only checked for and retrieved in the deploying phase.

#### The `DeployStructure` type (and its dependents)

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L131)

The phases of a deployment are linked through a data type called `DeployStructure` and its major dependents `PackageSpec`. `ActionSpec`, and `TriggerSpec` (as well as other dependent types). The contents are divided into

1. Fields that may be specified in `project.yml` without restriction.
2. Fields that may be specified in `project.yml` only when it was generated by a client deployer and sent to a deployer running in a runtime (the `slice` boolean will be `true` in this case).
3. Fields that may never be specified in `project.yml` but are added later during various deployment phases.

Note that, although the term `functions` is used externally, `actions` remains a valid alias for it and the term `actions` is still in use internally.   So, an `ActionSpec` specifies a function.

The project reading phase result is a `DeployStructure`.  That is also the input type of the remaining phases and the output type of the preparation and building phases.  Because any phase can discover errors, there is a distinguished `error` field in the structure.  A `DeployStructure` containing this field should not be passed to a subsequent phase.   Rather, the error should be converted directly into an error-carrying `DeployResponse` (see next section).

#### The `DeployResponse` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L178)

The output of the final ("deploy") phase is a different type from its input and takes the form of a `DeployResponse`.  This structure succinctly summarizes the success and failures that occurred during the deployment.  Successes are only reported when the deploy phase was reached (all earlier phases succeeded).  If any earlier phase returned a `DeployStructure` with the `error` field set, that error will be converted to a degenerate `DeployResponse` reporting that error and no successes.

In a slice deployer (doing a [remote build](#Remote-build) inside a runtime), the `DeployResponse` is converted to JSON and becomes the output of the remote build function, to be passed back to the client deployer.

When the deployer is the client deployer, the `DeployResponse` is further processed into the familiar human-readable results of a deployment.

#### The `readProject` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/api.ts#L157)

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

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L278)

The `Includer` type is a convenient internal representation of the information provided on the command line via the `--include` and `--exclude` flags.   It is used to filter parts of the project during deployment so that only the intended parts are processed.  The [`makeIncluder`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/includer.ts#L18) utility function converts the pair of flags into this object type.

##### The `Feedback` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L112)

The `Feedback` interface is used by the deployer to provide information that (ideally) should be displayed in real time rather than being provided at the end.  It has two methods, `progress` and `warn`.  The former is used for progress messages and the latter for warnings.  

The `LoggerFeedback` implementation simply wraps a `Logger` in a `Feedback` and is mostly what is used in practice.  The `LoggerFeedback` has a mutable boolean property `warnOnly` which suppresses `progress` messages.   This is used when remote builds are being performed in a runtime.  The progress messages will not be seen in real time anyway and will just clutter the build transcript so they are suppressed.

#### The `prepareToDeploy` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/api.ts#L252)

The `prepareToDeploy` function accepts a `DeployStructure`, an optional `Credentials` object, and a required `Flags` object.  The `DeployStructure` also has fields `credentials` and `flags` which are filled in by the end of the phase.  The phase is also responsible for noting the special case of a [remote build](#Remote-Build) running in a runtime (`slice==true`) and taking the credentials strictly from the `DeployStructure`.  Otherwise, it processes the low-level credential flags and the contents of the credential store prior to actually opening an OpenWhisk client handle.  A call to the controller is always made, either to find out the namespace associated with the credentials or to validate that the recorded namespace is still the one associated with the credentials.  The client handle itself is stored in the `DeployStructure`.

##### The `Credentials` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L264)

The `Credentials` type models a set of credentials for a namespace.  At one time, in legacy Nimbella, this set included several kinds of credentials besides OpenWhisk ones (for web deployment, GitHub, Commander, Postman, etc).   Now, the type simply summarizes the OpenWhisk credentials plus the DO API token.  At present, the DO API token is used only to deploy triggers.  Over time, it is expected to be used for more and more of the OpenWhisk CRUD API until, eventually, the OpenWhisk credentials will not need to be stored locally.

##### The `Flags` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L92)

The `Flags` type summarizes the flags that can be specified on the command line, both documented ones, and specialized ones that are primarily for internal use.

#### The `buildProject` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/api.ts#L224)

The `buildProject` function takes a `DeployStructure` as input and returns one as output.  It assumes that the `build` and `libBuild` fields were previously filled in, so there is a kind of "plan" for what builds must be run.  However, the actual running of those builds (if local) or the initiation of those builds (if remote) takes place in the scope of this function.

The term "building" is a bit overloaded in this context.  Please note the following.

1.  The main source file for the building phase is `finder-builder.ts` and that name is not an accident.  The processing of `.include` and `.ignore` directives (that is, "finding" all the artifacts that should be part of the deployment and assembling them into a zip) is part of the "building" phase.
2. There is thus the notion of a "real" build (as determined by the utility function `isRealBuild`).  A real build is defined as something that requires a subprocess and an work area in the file system.  So anything driven by `build.sh` or `package.json` is "real" but the process of assembling files and directories into a zip is not.
3. Only "real" builds will execute remotely.  So, even if the remote build flag is set, some "builds" (the ones that just "find" things) will still execute locally and the deploy step will also execute locally.

The `buildProject` function does not wait for the completion of remote builds.   Rather, the activation ids of the builder functions that are running those builds are recorded (field `buildResult` of `ActionSpec`) for interrogation during the deploy phase.  There is no activation id for the lib build because there is no independent initiation of a builder function for it.  Rather, the lib build will be run in the remote process prior to (or instead of) the function build and the remote process doesn't return a result until the function is actualy deployed.

#### The `deploy` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/api.ts#L133)

The `deploy` function has a `DeployStructure` as its single input argument and returns a `DeployResponse`.  At input, the contents of each function has been determined, so deployment primarily consists of driving remote APIs to accompish resource creation.

There are a number of more specialized things that happen in this phase, which are covered under internals.

#### Multi-phase convenience functions

The phased interface also has a number of convenience functions that drive more than one phase.

##### The `readAndPrepare` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/api.ts#L112)

This function drives the project reading phase followed by the preparation phase.  It does a bit more than just sequencing the phases because it takes care of building the `Includer` object and splitting up the flags for the `readProject` function, thus its interface is simplified.

Its inputs are the project path, the `Credentials`, the `Flags` and an optional `Feedback` object.  Its result is the result of the preparation phase.

##### The `readPrepareAndBuild` and `deployProject` functions

These simply drive the first three or all four phases in succession.  

## Internals

Much of the deployer codebase should be understandable just from reading the code with the externals in mind.  This section of the document tries to shed light on miscellaneous issues that might not be so clear.

### Project reading details

Most of the project reading implementation is in the [`project-reader.ts`](https://github.com/digitalocean/functions-deployer/blob/main/src/project-reader.ts) source file.

The actual reading of the project is abstracted via the interface [`ProjectReader`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L297).  Historically, we had a GitHub instantiation of this interface in addition to the file system one.  Currently, there is only one implementation (for the file system) but the abstraction is preserved since we may want to support deploying projects that are represented differently in the future.

The reading process is itself divided into sub-phases.

#### The `readTopLevel` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/project-reader.ts#L58)

This function explores the immediate contents of the project directory, finding significant files and recording them in the [`TopLevel`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/project-reader.ts#L45) data structure.  During this sub-phase, if the project path starts with `slice:` the [`fetchSlice`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/slice-reader.ts#L75) function is invoked to move the project into temporary storage in the file system.  See [remote build](#Remote-build).

#### The `buildStructureParts` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/project-reader.ts#L153)

This function expands the `TopLevel` structure into a pair of `DeployStructure` objects (the `actionsPart` and the `configPart`).  The former results from exploring the contents of the `packages` directory in the project.  The latter results from parsing and validating `project.yml` ("the config") and also receives some miscellaneous fields that we want to end up in the final `DeployStructure`.  One of these is the [`DeployerAnnotation`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy-struct.ts#L195) which is calculated in this sub-phase.  There is more about that in [Version Management and Incremental Deploy](#Version-Management-and-Incremental-Deploy).

#### The `buildActionsPart` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/project-reader.ts#L328)

This function and its subroutines explore the `packages` directory.  The contents are separated into files and directories.   The files are recorded as "strays" (they will have no affect on the deployment).  The directories are assumed to be packages and the [`readPackage`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/project-reader.ts#L385) function is used to read its contents.  That function iterates over the contents of one package directory, processing files and directories as potential functions, and checking for duplicates.  For files, the [`actionFileToParts`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/util.ts#L955) function is used to parse useful information from the file name.  For directories, the [`getBuildForAction`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/finder-builder.ts#L71) is called (logically a part of the building component) to determine the kind of build that will be performed.  In any case, each function is represented by an [`ActionSpec`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L41) and the entire package is represented by a [`PackageSpec`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/deploy-struct.ts#L21).

#### The `readConfig` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/project-reader.ts#L473)

This function and its subroutines load and validate `project.yml`.  Part of this process is symbol resolution (via the environment or an environment file) and another part is validation.  These are performed by [`substituteFromEnvAndFiles`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/util.ts#L1086) and [`validateDeployConfig`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/util.ts#L383) respectively.

#### The `assembleInitialStructure` function

The pair of `DeployStructure` objects are next merged into a single object by the [`assembleInitialStructure`](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/project-reader.ts#L203) function.  This works via recursive descent using various `merge*` functions.

#### The `checkBuildingRequirements` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/util.ts#L241)

This function is the final step in project reading.  It updates the `build` fields of actions with the special values `remote` or `remote-default` indicating that the building phase should send these actions to be built remotely.

### Building Details

At entry to the build phase, the project will have been completely read and the `build` (and `libBuild`) fields will have been filled in.  The primary tasks of this phase are performed by `maybeBuildLib` and `buildAllActions`

#### The `maybeBuildLib` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/finder-builder.ts#L440)

This function decides whether to build `lib` and dispatches the build if yes.  The `lib` build is always run, if present, in a slice deployer.   In a client deployer, the `lib` build is run if there are any local builds.  If all builds are remote, then the client deployer omits the `lib` build.

#### The `buildAllActions` function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/9cea0dd06ac7c1e0e8f8091a4d9142329b391107/src/finder-builder.ts#L83).

This function does a recursive descent through the packages and finds any actions that need building.  There is a short circuit if none are found, since if any are found the entire package array and its dependent action arrays have to be reconstructed so that objects remain properly connected.

When visiting each package, if any builds in the package will be remote, the package is deployed (once only, in the client deployer).  This is done to avoid the potential collisions that can occur if the package has multiple remote builds and those builds run in parallel in different slice deployers in different runtime containers.  If each slice deployer attempted to deploy the package, errors can occur when duplicate creations hit the controller at the same time (this error plagued large projects deployed via AP until this logic was added).  A package that has been deployed in this way is marked by setting the `deployedDuringBuild` property.  This will prevent it from being deployed again.

The recursive descent bottoms out in the [`buildAction`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L151) function.

#### Low level build functions

The process so far described for the build phase is all about locating and driving builds, but how are the builds actually accomplished? The `buildAction` and `maybeBuildLib` functions dispatch on the contents of the `build` or `libBuild` fields, respectively, and call a series of low level builder functions, documented briefly here.

##### The `build` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1229)

This function takes care of spawning a subprocess to run a real build.  Both `scriptBuilder` and `npmBuilder` call it.

##### The `scriptBuilder` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1295)

This function is called to run user-provided build scripts (`build.sh` and `build.cmd`).  It also handles the `.built` marker file (via the subroutine [`scriptAppearsBuilt`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1327), when the incremental option is set.

##### The `npmBuilder` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1391)

This function is called to run the `npm` or `yarn` utility if the user provides a `package.json`.  In addition to running the utility, this function determines whether the deploy is incremental and, if so, whether it is valid to skip the build.  The decision is carried out by the subroutines [`npmPackageAppearsBuilt`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1358) and [`scriptAppearsBuilt`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1327) depending on whether `package.json` specifies a `build` script.

##### The `doRemoteActionBuild` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L567)

This function is called to initiate a remote build for those functions that call for one.  It builds the project slice as an in-memory zip, and then starts the remote build via the [`invokeRemoteBuilder`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L923) function.

One subtlety involves _default_ remote builds.  This applies to compile-to-native runtimes (currently, our only one is `go`) where the user has not specified a build script.  In the project reading phase, the special build tag `remote-default` was assigned for this case.  The subroutine [`defaultRemote`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L641) will generate a build script for inclusion in the project slice in this case.  That script, in turn, calls scripts that are built into the runtime.

##### The `identifyActionFiles` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L328s)

This function is called directly when the `scriptBuilder` or `npmBuilder` or `doRemoteActionBuild` functions are not applicable (that is, a function expressed as a directory but with no "real" build).  It is also called _after_ the `npmBuilder` or `scriptBuilder` has done its work.  The purpose is to identify the files that are part of the function, using the `.include` and `.ignore` special files.  At the end of this process, with just a single file, the `singleFileBuilder` is called.  Otherwise (more than one file) the `autozipBuilder` is called.

##### The `autozipBuilder` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1096)

This function takes the list of files determined by `identifyActionFiles` and creates a zip, which becomes the code object of the function.  It also does some other things.

1. In an incremental deploy, it determines if it can skip zipping by consulting the [`zipFileAppearsCurrent`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1338) function.
2. If the runtime for the function has not yet been determined, it heuristically determines a runtime by using the [`agreeOnRuntime`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/util.ts#L335) function.

When zipping is complete, the `singleFileBuilder` is called to complete the work.

##### The `singleFileBuilder` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/finder-builder.ts#L1069)

This builder is for the case where there is only one file to deploy.  Either, `identifyActionFiles` completed with just a single file, or `autozipBuilder` has run, coalescing all the files to a single zip.  It fills in metadata computed from the single file's name.

### Deploy-phase details

The deploy phase divides into sub-phases handled by the functions `maybeLoadVersions` then `doDeploy` then `writeProjectStatus`.

#### The `maybeLoadVersions` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L57)

#### The `doDeploy` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L72)

The `doDeploy` does the bulk of the work in actually deploying the packages, bindings, functions (which include sequences), and triggers of the project.

The work of this function divides into sub-phases.  

First, the `skipPackageDeploy` variable is set, to suppress deploying packages when running as a slice deployer.  Logically, this flag is unnecessary since the `slice` member of the `DeployStructure` should be its equivalent.  However, when the current package deployment logic was rolled in, it was necessary to tolerate mismatched client and slice deployers (in either direction).  It is probably safe to simplify this logic now.

Next, the `deployPackage` function is called to deploy all the resources in the package except for sequences, if any.  The sequences are noted and deferred.

Next the `deploySequences` function is called on all of the packages of the project to deploy any sequences that were noted in the previous step.  

Finally, `combineResponses` is called to combine the results of the individual `deployPackage` calls and the `deploySequences` call.

#### The `deployPackage` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L249)

The steps in this function are

1. Check restrictions on the default package.  This is not a real package and quite a number of things that you can do with a real package are illegal for it.
2. If deploying the package (as opposed to its contained actions and triggers) is to be skipped, go immediately to `deployActionArray` and return.  The deployment of the package is always skipped in a slice deployer and it is skipped in a client deployer if the package was already deployed during the build step (because remote builds were detected).  There is also no package deployment for the "default" package (not a real package).
3. Otherwise, deploy the package using the (`onlyDeployPackage`) function.  This is the same function that is called in the build step when remote builds have been identified.  Recall that we do not deploy packages when running as a slice deployer because resource collisions can result as multiple slice deployers run in parallel on the same package (with different actions).  It follows that this step only occurs in a client deployer and only if there are no remote bilds.
4. The `deployActionArray` function is now called to deploy the contained actions and triggers of the package.
5. The `combineResponses` function is called to combine the results of everything deployed in the `deployPackage` function.

#### The `deployActionArray` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L144)

The main logic of this function concerns the imposition of the `DEPLOYMENT_CHUNK_SIZE` constant.  This constant is set from an (undocumented) environment variable and also has a default.  The logic ensures that no more than this limited number of action deployment promises are left to settle in parallel.  The goal is to avoid flooding the controller with an overly large number of deployment requests.   The actual deployment operation is carried out by the `deployAction` function.

#### The `deployAction` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L294)

This is the outer working function for deploying an action (which may be a sequence and may specify triggers).  Its steps are as follows.

1. If there is already a `buildError` recorded in the `ActionSpec`, immediately convert the error into an error-carrying `DeployResponse`.
2. If there is a `buildResult` (remote build activation id) recorded in the `ActionSpec`, delegate to `processRemoteResponse`.
3. If the the action is a sequence, check for superficial errors and, if the sequence is nominally legal, defer processing by adding the sequence to the `sequences` field of the `DeployStructure`.  The "result" for this action then becomes the empty response.  Deeper semantic errors are not found until later (in the `deploySequences` function).
4. Read the code from the file that resulted from the build.  Recall that the build step always ends up with a single file (by zipping if there were originally multiple ones).   The file is base64 encoded if binary.
5. Delegate the remainder of the processing to the `deployActionFromCodeOrSequence` function.

#### The `processRemoteReponse` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L94)

This function takes an activation ID and polls the remote controller for the completion of that activation.  The invoked function was a builder function which initiated a slice deploy.  When the function completes, the remote build and deploy steps have been completed for the action.  The response has two parts, a transcript and an 'outcome' (which is of type `DeployResponse`).  The transcript is fed through the `Feedback.progress` method (which will generally print to the console), approximating what would have happened if the build was local (except for the timing, since nothing prints until the remote action returns).  The 'outcome' then becomes the result of `deployAction`.

#### The `deployActionFromCodeOrSequence` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L551)

This function takes care of deploying ordinary actions (with a code body) and also sequences.  It is called with a code body when called from `deployAction` because sequences are not deployed until later.   It is called with a sequence description when called from `deploySequences`.

The logic is as follows.

1. When deploying code (only), calculate the action's digest and, if incremental, determine if it's feasible to skip the deployment.
2. Calculate the correct annotations for the action.  This consists of the deployer annotation, the annotations derived from the `web` and `webSecure` fields, and any annotations in an already-deployed version of the action if not overwritten by the previous.
3. Properly encode the OpenWhisk parameters for the action.  In `project.yml`, we distinguish between `parameters` and `environment` but OpenWhisk has only parameters.   Parameters that are to be placed in the enviroment are marked with `init=true`.
4. Build the `exec` portion of the action request body, differently for sequences versus code.
5. Deploy the action.
6. Deploy any triggers associated with the action by calling [`deployTriggers`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/triggers.ts#L33).

#### The `onlyDeployPackage` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L168)

This function deploys the package entity (package metadata, not including the contained actions).  OpenWhisk requires that the package entity exists before it will deploy actions belonging to the package.  The deployer takes care of this detail in various ways.

The entity that we refer to as a "binding" is really a package, bound to another package.  It provides its own metadata (typically environment and parameters) but inherits its actions from the package to which it is bound.  This function takes care of that detail as well.

The steps are as follows.

1.  Determine whether the package deployment can be skipped in an incremental deploy
2.  Get the annotations from the former package.
3. Merge the old annotations with the new deployer annotations.
4. Properly encode the OpenWhisk parameters (see discussion under `deployActionFromCodeOrSequence`).
5. If the package is a binding, check that it contains no actions of its own and set up to include its deployment as a success (assuming the next step succeeds).  Normally, package deployments are not listed under successes but bindings are treated as first-class resources in this context and so they are listed as successes.
6. Deploy the package and either return the success or an error result.

#### The `combineResponses` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/util.ts#L818)

This utility function is used by several deployer functions that deploy more than one resource.   The general logic elsewhere is to create arrays of promises which are then resolved to an array of `DeployResponse` with `Promise.all`.  The `combineResponses` function then has the responsibility of converting `DeployResponse[]` to `DeployResponse` by coalescing all the individual bits of information that are present in a `DeployResponse`.   The logic is straightforward.

#### The `deploySequences` Function

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L461)

This function is responsible for deploying all the sequences in a project, calling `deployActionFromCodeOrSequence` to do that actual deployment.

Several special issues arise when deploying sequences from a project.

1. The project may define sequences whose member actions are deployed in the same project.  We improve the prospects for success by deploying all non-sequence actions before deploying any sequences (see `deployAction` for details).
2. The members of a sequence may themeselves be sequences.  If they are being deployed in the same project, it is important to order the deployment of sequences so that members are deployed before the sequence containing them.  We accomplish this using the [`sortSequences`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy.ts#L364) subroutine.   The "sorting" is by recursively visiting dependencies and inserting them prior to inserting the encompassing sequence.  
3. Cycles in the deployment of a sequence are illegal.  In the process of sorting the sequences, we maintain the set of actions whose processing is in progress.  If an in-progress action is encountered again, we have a cycle and an error is indicated.
4. It should be noted that not all errors are found by the set of practices in this function.  Since it is legal for some of the member actions of sequences to be previously deployed (not deployed as part of the present project), it is not an error for a member action to be missing from the project and we deliberately don't check this.  So, there can be dangling references and even cycles that are not detected by the deployer and result in errors being reflected back by the controller.
5. Sequences may refer to actions in other namespaces (these are, of course, definitely outside the project since the project can only deploy to one namespace at a time).  The logic therefore pays attention to whether action names are fully qualified (including the namespace) and converts any namespace-relative names to that form.

### Version Management and Incremental Deploy

The deployer has a mechanism for tracking the versions of actions that have been deployed and using that information to guide incremental deploy.  The version information is also generally useful for a quick determination of what has been deployed most recently from a project.

#### Assumptions

Information is recorded both in the local file system and in the deployed actions and packages themselves.  These are not guaranteed to be in sync.  Assuming the developer does not do something idiotic like manually editing the local information, the main risk is local information will become stale due to other updates to the namespace.  These may occur either via the UI or by other CLI developers using competing project definitions or different versions of the project contents.  It is beyond the capacity of the deployer to keep local and remote views completely in sync.  So, the design focuses on making certain assurances in the special case where the following are true.

1. If there are multiple developers, they form a team.
2. The project is managed by a source repository, which is managed as a team resource.
3. No updates are made to the shared namespace except via the deployer, working from some clone of the common repository.
    - For a single developer, this is optional.  Even in a team, each developer can also have a private namespace, which serves as a testing scratchpad and need not be in sync with the shared namespace.

These properties will ensure that some synchronization points can be found, when the namespace contents correspond to a recent commit of the common repository.  Of course, there can also be time lags between updates to the namespace and updates to the repository, and loss of precision due to deploying from a clone with local modifications.

Some of these issues are avoided when using App Platform, since it insists on deploying only what is committed to a repository and has immutable namespaces with versioning and rollback.  A team that choses to use the deployer via `doctl` may be well advised to adopt a similar practice, deploying to its production namespace only via CI jobs that draw strictly from committed source.

The incremental deployment model assumes that the developer has exclusive use of the current namespace, which is presumably not the production namespace.  Thus, it is able to trust the local versioning information and use it to determine the state of the namespace.

#### The `DeployerAnnotation` type

[**Code**](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/deploy-struct.ts#L194)

Information about the most recent deployment is stored in each deployed package, binding, or action by means of a specific annotation with the key `deployer` and a value whose schema is provided by the `DeployerAnnotation` type.  Triggers do not have independent deployer annotations but, in general, we can assume they were last deployed in conjunction with their containing actions.

Fields in this structure are as follows.

- `repository` present if and only if the project is detected to be a git clone; gives the remote repository coordinates
- `commit` present if and only if the project is detected to be a git clone; gives the latest commit present in the clone, with `++` added if there are uncommitted changes
- `digest` summarizes the contents of the action or the package metadata
- `projectPath` the path to the project; this is relative to the git clone root if `repository` and `commit` are provided, otherwise absolute
- `user` identifies the developer.  This is taken from git metadata if possible, otherwise the operating system
- `zipped` indicates that the project
  newSliceHandling?: boolean;


During deployment, the `DeployerAnnotation` structure is initialized by the [`getDeployerAnnotation`](https://github.com/digitalocean/functions-deployer/blob/0a25dc78dcdadb75fb409defb681bcfc440e6fba/src/util.ts#L1263) function.

