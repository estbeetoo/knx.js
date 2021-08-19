/**
 * Created by aborovsky on 24.08.2015.
 */
// const debug = require('debug')('knx.js:KnxConnectionTunneling');
const KnxConnection = require('./KnxConnection');
const util = require('util');
const Promise = require('promise');
const connectionAliveProbe = require('./connectionAliveProbe');
const connectWithRetry = require('./connectWithRetry');
const { CONNECT_TIMEOUT } = require('./constants');

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

  this._localEndpoint = null; //IPEndPoint {host: host, port: port}
  this._stateRequestTimer = null; //Timer
  this._udpClient = null; //UdpClient
  this._sequenceNumber = null; //byte

  this._localEndpoint = {
    host: localIpAddress,
    port: localPort,
    toBytes: function () {
      if (!this.host || this.host === '')
        throw 'Cannot proceed toString for localIpAddress with empty host';
      if (localIpAddress.indexOf('.') === -1 || this.host.split('.').length < 4)
        throw 'Cannot proceed toString for localIpAddress with host[' + this.host + '], it should contain ip address';
      var result = new Buffer(4);
      var arr = localIpAddress.split('.');
      result[0] = parseInt(arr[0]) & 255;
      result[1] = parseInt(arr[1]) & 255;
      result[2] = parseInt(arr[2]) & 255;
      result[3] = parseInt(arr[3]) & 255;
      return result;
    }
  };

  this.ChannelId = 0x00;
}

util.inherits(KnxConnectionTunneling, KnxConnection);

KnxConnectionTunneling.prototype.GenerateSequenceNumber = function () {
  return this._sequenceNumber++;
};

KnxConnectionTunneling.prototype.RevertSingleSequenceNumber = function () {
  this._sequenceNumber--;
};

KnxConnectionTunneling.prototype.ResetSequenceNumber = function () {
  this._sequenceNumber = 0x00;
};

KnxConnectionTunneling.prototype.ClearReconnectRetry = function () {
  if (this.connectWithRetryWorker) {
    clearTimeout(this.connectWithRetryWorker);
    delete this.connectWithRetryWorker;
  }
};

KnxConnectionTunneling.prototype.ClearConnectTimeout = function () {
  if (this.connectRetry) {
    this.connectRetry.stop && this.connectRetry.stop();
    this.connectRetry = null;
  }
};

/// <summary>
///     Start the connection
/// </summary>
KnxConnectionTunneling.prototype.Connect = function (callback) {
  if (this.connected && this._udpClient) {
    callback && callback();
    return true;
  }
  this.connectRetry = connectWithRetry(this, callback);
};

/// <summary>
///     Stop the connection
/// </summary>
KnxConnectionTunneling.prototype.Disconnect = function (callback) {
  this.ClearConnectTimeout();
  this.ClearReconnectRetry();

  if (callback)
    this.once('disconnect', callback);

  try {
    this.TerminateStateRequest();
    new Promise(function (fulfill) {
      this.DisconnectRequest(fulfill);
    })
      .then(() => {
        this.knxReceiver.Stop();
        this._udpClient.close();
        this.connected = false;
        this.emit('close');
        this.emit('disconnect');
        this.emit('disconnected');
      });

  } catch (e) {
    this.emit('disconnect', e);
  }
};

const FIVE_MINUTES = 300000;
const TEN_SECONDS = 10000;

KnxConnectionTunneling.prototype.InitializeStateRequest = function () {
  const connect = () => this._stateRequestTimer = setTimeout(
    () => connectionAliveProbe(this, connect, FIVE_MINUTES - TEN_SECONDS),
    /*same time as ETS with group monitor open*/
    FIVE_MINUTES
  );
  connect();
};

KnxConnectionTunneling.prototype.TerminateStateRequest = function () {
  if (this._stateRequestTimer == null)
    return;
  clearTimeout(this._stateRequestTimer);
};

// TODO: I wonder if we can extract all these types of requests
KnxConnectionTunneling.prototype.ConnectRequest = function (callback) {
  // HEADER
  var datagram = new Buffer(26);
  datagram[0] = 0x06;
  datagram[1] = 0x10;
  datagram[2] = 0x02;
  datagram[3] = 0x05;
  datagram[4] = 0x00;
  datagram[5] = 0x1A;

  datagram[6] = 0x08;
  datagram[7] = 0x01;
  datagram[8] = this._localEndpoint.toBytes()[0];
  datagram[9] = this._localEndpoint.toBytes()[1];
  datagram[10] = this._localEndpoint.toBytes()[2];
  datagram[11] = this._localEndpoint.toBytes()[3];
  datagram[12] = (this._localEndpoint.port >> 8) & 255;
  datagram[13] = this._localEndpoint.port & 255;
  datagram[14] = 0x08;
  datagram[15] = 0x01;
  datagram[16] = this._localEndpoint.toBytes()[0];
  datagram[17] = this._localEndpoint.toBytes()[1];
  datagram[18] = this._localEndpoint.toBytes()[2];
  datagram[19] = this._localEndpoint.toBytes()[3];
  datagram[20] = (this._localEndpoint.port >> 8) & 255;
  datagram[21] = this._localEndpoint.port & 255;
  datagram[22] = 0x04;
  datagram[23] = 0x04;
  datagram[24] = 0x02;
  datagram[25] = 0x00;
  try {
    this.knxSender.SendDataSingle(datagram, callback);
  } catch (e) {
    callback && callback();
  }
};

KnxConnectionTunneling.prototype.StateRequest = function (callback) {
  // HEADER
  var datagram = new Buffer(16);
  datagram[0] = 0x06;
  datagram[1] = 0x10;
  datagram[2] = 0x02;
  datagram[3] = 0x07;
  datagram[4] = 0x00;
  datagram[5] = 0x10;

  datagram[5] = this.ChannelId;
  datagram[7] = 0x00;
  datagram[8] = 0x08;
  datagram[9] = 0x01;
  datagram[10] = this._localEndpoint.toBytes()[0];
  datagram[11] = this._localEndpoint.toBytes()[1];
  datagram[12] = this._localEndpoint.toBytes()[2];
  datagram[13] = this._localEndpoint.toBytes()[3];
  datagram[14] = (this._localEndpoint.port >> 8) & 255;
  datagram[15] = this._localEndpoint.port & 255;

  try {
    this.knxSender.SendData(datagram, callback);
  } catch (e) {
    callback(e);
  }
};

KnxConnectionTunneling.prototype.DisconnectRequest = function (callback) {
  if (!this.connected) {
    callback && callback();
    return false;
  }
  // HEADER
  var datagram = new Buffer(16);
  datagram[0] = 0x06;
  datagram[1] = 0x10;
  datagram[2] = 0x02;
  datagram[3] = 0x09;
  datagram[4] = 0x00;
  datagram[5] = 0x10;

  datagram[6] = this.ChannelId;
  datagram[7] = 0x00;
  datagram[8] = 0x08;
  datagram[9] = 0x01;
  datagram[10] = this._localEndpoint.toBytes()[0];
  datagram[11] = this._localEndpoint.toBytes()[1];
  datagram[12] = this._localEndpoint.toBytes()[2];
  datagram[13] = this._localEndpoint.toBytes()[3];
  datagram[14] = (this._localEndpoint.port >> 8) & 255;
  datagram[15] = this._localEndpoint.port & 255;
  try {
    this.knxSender.SendData(datagram, callback);
  } catch (e) {
    callback(e);
  }
};

module.exports = KnxConnectionTunneling;
