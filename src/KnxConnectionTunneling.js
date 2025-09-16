/**
 * Created by aborovsky on 24.08.2015.
 * Updated: hardened keepalive + reconnection logic, fixed context/timer bugs, and KNXnet/IP datagrams.
 */

var CONNECT_TIMEOUT = 5000;
var KnxConnection = require("./KnxConnection");
var KnxReceiverTunneling = require("./KnxReceiverTunneling");
var KnxSenderTunneling = require("./KnxSenderTunneling");
var ConnectionErrorException = require("./ConnectionErrorException");
var util = require("util");
var dgram = require("dgram");
var Promise = require("promise");

var STATE_REQUEST_INTERVAL = 60000; // ping gateway every 60s
var MISSED_ALIVE_LIMIT = 3;         // reconnect after 3 consecutive missed alives

/// <summary>
///     Initializes a new KNX tunneling connection with provided values. Make sure the local system allows
///     UDP messages to the localIpAddress and localPort provided
/// </summary>
/// <param name="remoteIpAddress">Remote gateway IP address</param>
/// <param name="remotePort">Remote gateway port</param>
/// <param name="localIpAddress">Local IP address to bind to</param>
/// <param name="localPort">Local port to bind to</param>
function KnxConnectionTunneling(remoteIpAddress, remotePort, localIpAddress, localPort) {
  KnxConnectionTunneling.super_.call(this, remoteIpAddress, remotePort, localIpAddress, localPort);

  this._localEndpoint = null;     // IPEndPoint {host, port}
  this._stateRequestTimer = null; // Timer
  this._udpClient = null;         // dgram socket
  this._sequenceNumber = null;    // byte
  this.lastActivity = Date.now(); // track last inbound activity
  this._missedAlive = 0;

  this._localEndpoint = {
    host: localIpAddress,
    port: localPort,
    toBytes: function () {
      if (!this.host || this.host === "")
        throw "Cannot proceed toString for localIpAddress with empty host";
      if (localIpAddress.indexOf(".") === -1 || this.host.split(".").length < 4)
        throw (
          "Cannot proceed toString for localIpAddress with host[" +
          this.host +
          "], it should contain ip address"
        );
      var result = Buffer.alloc(4);
      var arr = localIpAddress.split(".");
      result[0] = parseInt(arr[0], 10) & 255;
      result[1] = parseInt(arr[1], 10) & 255;
      result[2] = parseInt(arr[2], 10) & 255;
      result[3] = parseInt(arr[3], 10) & 255;
      return result;
    },
  };

  // mark inbound helper bound to this instance
  this.markInbound = () => {
    this.lastActivity = Date.now();
    this._missedAlive = 0;
  };

  this.ChannelId = 0x00;
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

// ---------------------- timeout helpers ----------------------
KnxConnectionTunneling.prototype.ClearReconnectTimeout = function () {
  var that = this;
  if (that.reConnectTimeout) {
    clearTimeout(that.reConnectTimeout);
    delete that.reConnectTimeout;
  }
};

KnxConnectionTunneling.prototype.ClearConnectTimeout = function () {
  var that = this;
  if (that.connectTimeout) {
    clearTimeout(that.connectTimeout);
    delete that.connectTimeout;
  }
};

function delay(time) {
  return new Promise(function (fulfill) {
    setTimeout(fulfill, time);
  });
}

/**
 * Run `func(fulfill)` and wait up to `time` ms; if not fulfilled, run `timeoutFunc`.
 * Returns a race promise (mostly for completeness).
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
    if (!success) return timeoutFunc && timeoutFunc();
  });

  return Promise.race([succPromise, timeoutPromise]);
}

// ---------------------- start/stop ----------------------
KnxConnectionTunneling.prototype.Connect = function (callback) {
  var that = this;

  if (this.connected && this._udpClient) {
    callback && callback();
    return true;
  }

  this.connectTimeout = setTimeout(function () {
    that.removeListener("connected", that.ClearConnectTimeout);
    that.Disconnect(function () {
      if (that.debug) console.log("Error connecting: timeout");
      callback &&
        callback({ msg: "Error connecting: timeout", reason: "CONNECTTIMEOUT" });
      that.ClearReconnectTimeout();
      // FIX: use `that` not `this`
      that.reConnectTimeout = setTimeout(function () {
        if (that.debug) console.log("reconnecting");
        that.Connect(callback);
      }, 3 * CONNECT_TIMEOUT);
    });
  }, CONNECT_TIMEOUT);

  this.once("connected", that.ClearConnectTimeout);
  if (callback) {
    this.removeListener("connected", callback);
    this.once("connected", callback);
  }

  try {
    if (this._udpClient != null) {
      try {
        this._udpClient.close();
      } catch (e) {
        // ignore
      }
    }
    this._udpClient = dgram.createSocket("udp4");
  } catch (e) {
    // FIX: use `e` not `ex`
    throw new ConnectionErrorException(ConnectionConfiguration, e);
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
      that.emit("connect");
      that.emit("connecting");
    });
};

KnxConnectionTunneling.prototype.Disconnect = function (callback) {
  var that = this;

  that.ClearConnectTimeout();
  that.ClearReconnectTimeout();

  if (callback) that.once("disconnect", callback);

  try {
    this.TerminateStateRequest();
    new Promise(function (fulfill) {
      that.DisconnectRequest(fulfill);
    }).then(function () {
      that.knxReceiver.Stop();
      try {
        that._udpClient && that._udpClient.close();
      } catch (e) {
        // ignore
      }
      that.connected = false;
      that.emit("close");
      that.emit("disconnect");
      that.emit("disconnected");
    });
  } catch (e) {
    that.emit("disconnect", e);
  }
};

// ---------------------- keepalive loop ----------------------
KnxConnectionTunneling.prototype.InitializeStateRequest = function () {
  const self = this;

  const runStateCheck = () => {
    if (!self.connected || !self.ChannelId) return;

    // Per-cycle 'alive' waiter
    const onAliveOnce = function () {
      // reset miss counter on successful keepalive
      self._missedAlive = 0;
      // also mark inbound to refresh idle timer
      if (typeof self.markInbound === "function") self.markInbound();
    };

    // Expect 'alive' within 2 * CONNECT_TIMEOUT
    timeout(
      (fulfill) => {
        // Attach a single waiter for this cycle only
        const handler = function () {
          self.removeListener("alive", handler);
          onAliveOnce();
          fulfill();
        };
        self.once("alive", handler);

        // Fire StateRequest (send errors are ignored; timeout fallback handles)
        self.StateRequest(function () {});
      },
      2 * CONNECT_TIMEOUT,
      () => {
        // didn't see 'alive' in time
        self._missedAlive = (self._missedAlive || 0) + 1;
        if (self.debug) {
          console.log(
            `missed alive (#${self._missedAlive}) — last inbound ${Date.now() - (self.lastActivity || 0)} ms ago`
          );
        }
        if (self._missedAlive >= MISSED_ALIVE_LIMIT) {
          if (self.debug) console.log("too many missed alives, reconnecting");
          new Promise((fulfill) => self.Disconnect(fulfill)).then(() => self.Connect());
        }
      }
    );
  };

  this.TerminateStateRequest();
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
  datagram[2] = 0x02;       // KNXnet/IP Core
  datagram[3] = serviceType; // 0x05 ConnectReq, 0x07 ConnectionStateReq, 0x09 DisconnectReq
  datagram[4] = (length >> 8) & 255;
  datagram[5] = length & 255;
  return datagram;
};

KnxConnectionTunneling.prototype._writeLocalEndpointHPAI = function (buffer, offset) {
  var endpointBytes = this._localEndpoint.toBytes();
  buffer[offset] = 0x08;           // HPAI length
  buffer[offset + 1] = 0x01;       // IPv4 UDP
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
    callback && callback();
  }
};

KnxConnectionTunneling.prototype.StateRequest = function (callback) {
  var datagram = this._createRequestDatagram(0x07, 16);
  // Per KNXnet/IP spec, channel id at offset 6, reserved at 7
  datagram[6] = this.ChannelId;
  datagram[7] = 0x00;
  this._writeLocalEndpointHPAI(datagram, 8); // control endpoint
  try {
    this.knxSender.SendData(datagram, callback);
  } catch (e) {
    callback && callback(e);
  }
};

KnxConnectionTunneling.prototype.DisconnectRequest = function (callback) {
  if (!this.connected) {
    callback && callback();
    return false;
  }
  var datagram = this._createRequestDatagram(0x09, 16);
  datagram[6] = this.ChannelId;
  datagram[7] = 0x00;
  this._writeLocalEndpointHPAI(datagram, 8);
  try {
    this.knxSender.SendData(datagram, callback);
  } catch (e) {
    callback && callback(e);
  }
};

module.exports = KnxConnectionTunneling;
