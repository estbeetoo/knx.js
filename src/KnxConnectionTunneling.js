'use strict';
/**
 * Created by aborovsky on 24.08.2015.
 * Updated: hardened keepalive + reconnection logic, fixed context/timer bugs, and KNXnet/IP datagrams.
 */

var CONNECT_TIMEOUT = 5000;
var STATE_REQUEST_INTERVAL = 60000; // ping gateway every 60s
var MISSED_ALIVE_LIMIT = 3;         // reconnect after 3 consecutive missed alives

var KnxConnection = require('./KnxConnection');
var KnxReceiverTunneling = require('./KnxReceiverTunneling');
var KnxSenderTunneling = require('./KnxSenderTunneling');
var ConnectionErrorException = require('./ConnectionErrorException');
var util = require('util');
var dgram = require('dgram');
var Promise = require('promise'); // keep repo's promise impl for consistency

/// <summary>
///     Initializes a new KNX tunneling connection with provided values. Make sure the local system allows
///     UDP messages to the localIpAddress and localPort provided
/// </summary>
/// <param name="remoteIpAddress">Remote gateway IP address</param>
/// <param name="remotePort">Remote gateway port</param>
/// <param name="localIpAddress">Local IP address to bind to</param>
/// <param name="localPort">Local port to bind to</param>
function KnxConnectionTunneling(remoteIpAddress, remotePort, localIpAddress, localPort) {
  KnxConnectionTunneling.super_.call(
    this,
    remoteIpAddress,
    remotePort,
    localIpAddress,
    localPort
  );

  this._localEndpoint = null;     // { host, port }
  this._stateRequestTimer = null; // Timer
  this._udpClient = null;         // dgram socket
  this._sequenceNumber = 0x00;    // byte
  this.lastActivity = Date.now(); // track last inbound activity
  this._missedAlive = 0;

  this._localEndpoint = {
    host: localIpAddress,
    port: localPort,
    toBytes: function () {
      if (!this.host || this.host === '')
        throw new Error('Cannot toBytes() for localIpAddress with empty host');
      if (localIpAddress.indexOf('.') === -1 || this.host.split('.').length < 4)
        throw new Error(
          'Invalid localIpAddress host[' + this.host + '], it should contain IPv4 address'
        );
      var result = Buffer.alloc(4);
      var arr = localIpAddress.split('.');
      result[0] = parseInt(arr[0], 10) & 255;
      result[1] = parseInt(arr[1], 10) & 255;
      result[2] = parseInt(arr[2], 10) & 255;
      result[3] = parseInt(arr[3], 10) & 255;
      return result;
    },
  };

  // helper to mark inbound traffic, resets alive counter
  this.markInbound = () => {
    this.lastActivity = Date.now();
    this._missedAlive = 0;
  };

  this.ChannelId = 0x00; // set after successful ConnectResp elsewhere
}
util.inherits(KnxConnectionTunneling, KnxConnection);

// ---------------------- sequence helpers ----------------------
KnxConnectionTunneling.prototype.GenerateSequenceNumber = function () {
  return this._sequenceNumber++;
};
KnxConnectionTunneling.prototype.RevertSingleSequenceNumber = function () {
  this._sequenceNumber--;
};
KnxConnectionTunneling.prototype.ResetSequenceNumber = function () {
  this._sequenceNumber = 0x00;
};

// ---------------------- timer helpers ----------------------
KnxConnectionTunneling.prototype.ClearReconnectTimeout = function () {
  if (this.reConnectTimeout) {
    clearTimeout(this.reConnectTimeout);
    delete this.reConnectTimeout;
  }
};
KnxConnectionTunneling.prototype.ClearConnectTimeout = function () {
  if (this.connectTimeout) {
    clearTimeout(this.connectTimeout);
    delete this.connectTimeout;
  }
};

function delay(time) {
  return new Promise(function (fulfill) {
    setTimeout(fulfill, time);
  });
}

/**
 * Run `func(fulfill)` and wait up to `time` ms; if not fulfilled, run `timeoutFunc`.
 */
function timeout(func, time, timeoutFunc) {
  var success = null;

  var succPromise = new Promise(function (fulfill, reject) {
    func(function () {
      if (success === null) {
        fulfill();
        success = true;
      } else {
        reject();
      }
    });
  });

  var timeoutPromise = delay(time);
  timeoutPromise.then(function () {
    if (!success && typeof timeoutFunc === 'function') timeoutFunc();
  });

  return Promise.race([succPromise, timeoutPromise]);
}

// ---------------------- start/stop ----------------------
KnxConnectionTunneling.prototype.Connect = function (callback) {
  var that = this;

  if (this.connected && this._udpClient) {
    if (callback) callback();
    return true;
  }

  this.connectTimeout = setTimeout(function () {
    that.removeListener('connected', that.ClearConnectTimeout);
    that.Disconnect(function () {
      if (that.debug) console.log('Error connecting: timeout');
      if (callback)
        callback({ msg: 'Error connecting: timeout', reason: 'CONNECTTIMEOUT' });
      that.ClearReconnectTimeout();
      that.reConnectTimeout = setTimeout(function () {
        if (that.debug) console.log('reconnecting');
        that.Connect(callback);
      }, 3 * CONNECT_TIMEOUT);
    });
  }, CONNECT_TIMEOUT);

  this.once('connected', that.ClearConnectTimeout);
  if (callback) {
    this.removeListener('connected', callback);
    this.once('connected', callback);
  }

  try {
    if (this._udpClient) {
      try {
        this._udpClient.close();
      } catch (_) {}
    }
    this._udpClient = dgram.createSocket('udp4');
  } catch (e) {
    throw new ConnectionErrorException('UDP_CREATE_FAILED', e);
  }

  if (this.knxReceiver == null || this.knxSender == null) {
    this.knxReceiver = new KnxReceiverTunneling(this, this._udpClient, this._localEndpoint);
    this.knxSender = new KnxSenderTunneling(this, this._udpClient, this.RemoteEndpoint);
  } else {
    this.knxReceiver.SetClient(this._udpClient);
    this.knxSender.SetClient(this._udpClient);
  }

  new Promise(function (fulfill) {
    that.knxReceiver.Start(fulfill);
  })
    .then(function () {
      that.InitializeStateRequest();
    })
    .then(function () {
      that.ConnectRequest();
    })
    .then(function () {
      that.emit('connect');
      that.emit('connecting');
    });
};

KnxConnectionTunneling.prototype.Disconnect = function (callback) {
  var that = this;

  that.ClearConnectTimeout();
  that.ClearReconnectTimeout();

  if (callback) that.once('disconnect', callback);

  try {
    this.TerminateStateRequest();
    new Promise(function (fulfill) {
      that.DisconnectRequest(fulfill);
    }).then(function () {
      if (that.knxReceiver && typeof that.knxReceiver.Stop === 'function') {
        that.knxReceiver.Stop();
      }
      try {
        that._udpClient && that._udpClient.close();
      } catch (_) {}
      that.connected = false;
      that.emit('close');
      that.emit('disconnect');
      that.emit('disconnected');
    });
  } catch (e) {
    that.emit('disconnect', e);
  }
};

// ---------------------- keepalive loop ----------------------
KnxConnectionTunneling.prototype.InitializeStateRequest = function () {
  const self = this;

  // ensure only one loop exists
  this.TerminateStateRequest();

  const runStateCheck = () => {
    if (!self.connected || !self.ChannelId) return;

    // expect 'alive' within 2 * CONNECT_TIMEOUT
    timeout(
      (fulfill) => {
        const handler = function () {
          self.removeListener('alive', handler);
          self._missedAlive = 0;
          if (typeof self.markInbound === 'function') self.markInbound();
          fulfill();
        };
        self.once('alive', handler);

        // send state request (errors ignored; timeout path handles recovery)
        self.StateRequest(function () {});
      },
      2 * CONNECT_TIMEOUT,
      () => {
        self._missedAlive = (self._missedAlive || 0) + 1;
        if (self.debug) {
          console.log(
            `missed alive (#${self._missedAlive}) — last inbound ${Date.now() - (self.lastActivity || 0)} ms ago`
          );
        }
        if (self._missedAlive >= MISSED_ALIVE_LIMIT) {
          if (self.debug) console.log('too many missed alives, reconnecting');
          new Promise((fulfill) => self.Disconnect(fulfill)).then(() => self.Connect());
        }
      }
    );
  };

  this._stateRequestTimer = setInterval(runStateCheck, STATE_REQUEST_INTERVAL);
  runStateCheck();
};

KnxConnectionTunneling.prototype.TerminateStateRequest = function () {
  if (this._stateRequestTimer == null) return;
  clearInterval(this._stateRequestTimer);
  this._stateRequestTimer = null;
};

// ---------------------- datagram helpers ----------------------
KnxConnectionTunneling.prototype._createRequestDatagram = function (serviceType, length) {
  var datagram = Buffer.alloc(length);
  datagram[0] = 0x06;
  datagram[1] = 0x10;
  datagram[2] = 0x02;        // KNXnet/IP Core
  datagram[3] = serviceType; // 0x05 ConnectReq, 0x07 ConnectionStateReq, 0x09 DisconnectReq
  datagram[4] = (length >> 8) & 255;
  datagram[5] = length & 255;
  return datagram;
};

KnxConnectionTunneling.prototype._writeLocalEndpointHPAI = function (buffer, offset) {
  var endpointBytes = this._localEndpoint.toBytes();
  buffer[offset] = 0x08;     // HPAI length
  buffer[offset + 1] = 0x01; // IPv4 UDP
  buffer[offset + 2] = endpointBytes[0];
  buffer[offset + 3] = endpointBytes[1];
  buffer[offset + 4] = endpointBytes[2];
  buffer[offset + 5] = endpointBytes[3];
  buffer[offset + 6] = (this._localEndpoint.port >> 8) & 255;
  buffer[offset + 7] = this._localEndpoint.port & 255;
};

// ---------------------- KNXnet/IP requests ----------------------
KnxConnectionTunneling.prototype.ConnectRequest = function (callback) {
  var datagram = this._createRequestDatagram(0x05, 26);
  this._writeLocalEndpointHPAI(datagram, 6);   // control endpoint
  this._writeLocalEndpointHPAI(datagram, 14);  // data endpoint
  datagram[22] = 0x04; // CRI length
  datagram[23] = 0x04; // Tunnel connection
  datagram[24] = 0x02; // KNX layer = TUNNEL_LINKLAYER
  datagram[25] = 0x00; // reserved
  try {
    this.knxSender.SendDataSingle(datagram, callback);
  } catch (e) {
    if (callback) callback(e);
  }
};

KnxConnectionTunneling.prototype.StateRequest = function (callback) {
  var datagram = this._createRequestDatagram(0x07, 16);
  datagram[6] = this.ChannelId; // channel id
  datagram[7] = 0x00;           // reserved
  this._writeLocalEndpointHPAI(datagram, 8); // control endpoint
  try {
    this.knxSender.SendData(datagram, callback);
  } catch (e) {
    if (callback) callback(e);
  }
};

KnxConnectionTunneling.prototype.DisconnectRequest = function (callback) {
  if (!this.connected) {
    if (callback) callback();
    return false;
  }
  var datagram = this._createRequestDatagram(0x09, 16);
  datagram[6] = this.ChannelId;
  datagram[7] = 0x00;
  this._writeLocalEndpointHPAI(datagram, 8);
  try {
    this.knxSender.SendData(datagram, callback);
  } catch (e) {
    if (callback) callback(e);
  }
};

module.exports = KnxConnectionTunneling;
