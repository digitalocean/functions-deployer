const {
  runCommand,
  CaptureLogger,
  DefaultLogger,
  initializeAPI
} = require('@digitalocean/functions-deployer');

// Main execution sequence
main().then(flush).catch(handleError);

// Main logic handles everything except cleanup and error handling
async function main() {
  if (process.argv.length < 4) {
    throw new Error(
      'Internal error: too few arguments passed to serverless plugin'
    );
  }

  let result = {};
  try {
    // Ensure that doctl's user agent is used
    initializeAPI(process.env.NIM_USER_AGENT);

    // Process special "command" which is really a directive not to capture the output.
    // This is to be used by commands that typically run indefinitely in their own console.
    // Right now, 'watch' is the only such command, but it seems better to use a positive
    // directive rather than making 'watch' special.
    if (process.argv[2] === 'nocapture') {
      await runCommand(process.argv.slice(3), new DefaultLogger());
      return; // not normally reached
    }

    // The normal path in which output is captured
    const captureLogger = new CaptureLogger();
    await runCommand(process.argv.slice(2), captureLogger);
    const { captured, table, entity, errors } = captureLogger;
    // Some errors (particularly in deploy steps) are not thrown by nim and may occur in multiples.
    // These are handled specially here so that doctl has only an error string to deal with similar
    // to errors that are thrown.
    const error = errors?.join('\n');
    result = { captured, table, entity, error };
  } catch (err) {
    result = { error: err.message };
  }
  console.log(JSON.stringify(result, null, 2));
}

// Ensure that console output is flushed when the command is really finished
async function flush() {
  process.stdout.once('drain', () => process.exit(0));
}

// Deal with errors thrown from within 'nim'
function handleError(err) {
  console.error(err);
  process.exit(1);
}
