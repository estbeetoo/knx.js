const retry = require('retry');
const { CONNECT_TIMEOUT } = require('./constants');
const debug = require('debug')('knx.js:connectWithRetry');
const KnxReceiverTunneling = require('./KnxReceiverTunneling');
const KnxSenderTunneling = require('./KnxSenderTunneling');
const ConnectionErrorException = require('./ConnectionErrorException');
const dgram = require('dgram');

module.exports = (connection, _cb) => {
  if (!connection) {
    return _cb(new Error('First argument must be a KNX connection'));
  }
  const operation = retry.operation({
    minTimeout: 3 * CONNECT_TIMEOUT,
    maxTimeout: 10 * CONNECT_TIMEOUT,
    randomize: true,
    unref: false,
    maxRetryTime: 3 * CONNECT_TIMEOUT
  });

  const cb = (err, currentAttempt) => {
    if (operation.retry(err)) {
      debug(`attempt #${currentAttempt} failed with: ${err}`);
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
    connection.removeListener('connected', cb);
    connection.once('connected', err => cb(err, currentAttempt));
    try {
      if (connection._udpClient != null) {
        try {
          connection._udpClient.close();
        } catch (e) {
          // ignore
        }
      }
      connection._udpClient = dgram.createSocket('udp4');
    } catch (e) {
      throw new ConnectionErrorException(ConnectionConfiguration, ex);
    }

    if (connection.knxReceiver == null || connection.knxSender == null) {
      connection.knxReceiver = new KnxReceiverTunneling(connection, connection._udpClient, connection._localEndpoint);
      connection.knxSender = new KnxSenderTunneling(connection, connection._udpClient, connection.RemoteEndpoint);
    } else {
      connection.knxReceiver.SetClient(connection._udpClient);
      connection.knxSender.SetClient(connection._udpClient);
    }

    new Promise(resolve => connection.knxReceiver.Start(resolve))
      .then(() => connection.InitializeStateRequest())
      .then(() => connection.ConnectRequest())
      .then(() => {
        connection.emit('connect');
        connection.emit('connecting');
      });
  });

  return operation;
};
