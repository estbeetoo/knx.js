const retry = require('retry');
const Promise = require('promise');
const debug = require('debug')('knx.js:connectKNXWithForeverRetries');
const CONNECT_TIMEOUT = 5000;

const runAsyncWithTimeout = (fn, timeout, msg = 'timeouted') => Promise.race([
  new Promise((resolve, reject) => setTimeout(() => reject(new Error(msg)), timeout)),
  new Promise((resolve, reject) => {
    try {
      fn(resolve, reject);
    } catch (err) {
      reject(err);
    }
  })
]);

const connectKNXWithForeverRetries = (connection, _cb) => {
  const operation = retry.operation({
    minTimeout: 3 * CONNECT_TIMEOUT,
    maxTimeout: 10 * CONNECT_TIMEOUT,
    randomize: true,
    unref: true,
    maxRetryTime: 3 * CONNECT_TIMEOUT
  });

  const cb = (err, currentAttempt) => {
    if (operation.retry(err)) {
      debug(`connectKNXWithForeverRetries attempt #${currentAttempt} failed with: ${err}`);
      return;
    }
    if (err) {
      const msg = `After ${currentAttempt} attempts err presented and 'retry' lib attempts count reached limit, it should never be the case cause attempts count is Infinite`;
      console.error(msg);
      _cb(new Error(msg));
    } else {
      debug(`connectKNXWithForeverRetries attempt #${currentAttempt} succeeded`);
      _cb();
    }
  };

  operation.attempt(currentAttempt => {
    connection.removeAllListeners('alive');
    debug('send StateRequest');
    connection.StateRequest(err => {
        if (!err) {
          debug('StateRequest response, no error');
          runAsyncWithTimeout(resolve => connection.once('alive', resolve), CONNECT_TIMEOUT, 'alive feedback timeouted').then(
            () => cb(null, currentAttempt),
            err => {
              // debug('alive feedback timeouted => connection stale, try to disconnect/connect before next StateRequest');
              // runAsyncWithTimeout(resolve => connection.Disconnect(resolve), CONNECT_TIMEOUT, 'disconnect timeouted')
              //   .then(() => runAsyncWithTimeout(resolve => connection.Connect(resolve), CONNECT_TIMEOUT, 'connect timeouted'))
              //   .catch(err => console.error(`Error while disconnect/connect: ${err}`))
              //   .then(() => cb(err, currentAttempt));
              cb(err, currentAttempt);
            }
          );
        } else {
          debug(`StateRequest with error: ${err}`);
          cb(err, currentAttempt);
        }
      }
    );
  });
};

module.exports = connectKNXWithForeverRetries;
