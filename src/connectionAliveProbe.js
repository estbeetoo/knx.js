const retry = require('retry');
const { CONNECT_TIMEOUT } = require('./constants');
const debug = require('debug')('knx.js:connectionAliveProbe');

module.exports = (connection, _cb) => {
  if (!connection) {
    return _cb(new Error('First argument must be a KNX connection'));
  }
  const operation = retry.operation({
    minTimeout: 3 * CONNECT_TIMEOUT,
    maxTimeout: 10 * CONNECT_TIMEOUT,
    randomize: true,
    unref: true,
    maxRetryTime: 3 * CONNECT_TIMEOUT
  });

  const cb = (err, currentAttempt) => {
    if (operation.retry(err)) {
      debug(`attempt #${currentAttempt} failed with: ${err}, reconnect`);
      connection.Disconnect();
      return;
    }
    if (err) {
      const msg = `After ${currentAttempt} attempts err presented and 'retry' lib attempts count reached limit, it should never be the case cause attempts count is Infinite`;
      console.error(msg);
      _cb(new Error(msg));
    } else {
      debug(`attempt #${currentAttempt} succeeded`);
      _cb();
    }
  };

  operation.attempt(currentAttempt => {
    debug('send StateRequest');
    connection.StateRequest(err => {
        if (!err) {
          debug('StateRequest sent, no error');
        } else {
          debug(`StateRequest sent with error: ${err}`);
        }
        cb(err, currentAttempt);
      }
    );
  });
};
