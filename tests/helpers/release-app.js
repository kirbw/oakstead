// Test-only entry point. No Git command ever touches the checkout or network.
const cp = require('node:child_process');
const spawn = cp.spawn;
process.env.OAKSTEAD_UPDATE_MODE = 'git';
cp.spawn = function(command, args, options) {
  if (command !== 'git') return spawn(command, args, options);
  if (args[0] === 'fetch') {
    console.log('TEST_RELEASE_FETCH');
    return spawn(process.execPath, ['-e', 'setTimeout(()=>{},1500)'], options);
  }
  return spawn(process.execPath, ['-e', 'console.log("v999.0.0-beta.1\\nv998.0.0")'], options);
};
const app = require('../../server').createApplication();
require('../../server/lifecycle').installShutdownSignals(app);
void app.start();
