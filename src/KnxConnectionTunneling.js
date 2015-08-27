/**
 * Created by aborovsky on 24.08.2015.
 */

var KnxConnection = require('./KnxConnection');
var KnxReceiverTunneling = require('./KnxReceiverTunneling');
var KnxSenderTunneling = require('./KnxSenderTunneling');
var ConnectionErrorException = require('./ConnectionErrorException');
var util = require('util');
var dgram = require('dgram');


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
                throw 'Cannot proceed toString for localIpAddress with empy host'
            if (localIpAddress.indexOf('.') === -1 || this.host.split('.').length < 4)
                throw 'Cannot proceed toString for localIpAddress with host[' + this.host + '], it should contain ip address'
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
}

KnxConnectionTunneling.prototype.RevertSingleSequenceNumber = function () {
    this._sequenceNumber--;
}

KnxConnectionTunneling.prototype.ResetSequenceNumber = function () {
    this._sequenceNumber = 0x00;
}

/// <summary>
///     Start the connection
/// </summary>
KnxConnectionTunneling.prototype.Connect = function (callback) {
    if (this.connected && this._udpClient) {
        callback && callback();
        return true;
    }
    if (callback)
        this.once('connected', callback);
    try {
        if (this._udpClient != null) {
            try {
                this._udpClient.close();
                //this._udpClient.Client.Dispose();
            }
            catch (e) {
                // ignore
            }
        }
        this._udpClient = dgram.createSocket("udp4");//new UdpClient(_localEndpoint)
    }
    catch (e) {
        throw new ConnectionErrorException(ConnectionConfiguration, ex);
    }

    if (this.knxReceiver == null || this.knxSender == null) {
        this.knxReceiver = new KnxReceiverTunneling(this, this._udpClient, this._localEndpoint);
        this.knxSender = new KnxSenderTunneling(this, this._udpClient, this.RemoteEndpoint);
    }
    else {
        this.knxReceiver.SetClient(this._udpClient);
        this.knxSender.SetClient(this._udpClient);
    }

    var that = this;

    this.knxReceiver.Start(function () {
        that.InitializeStateRequest();

        try {
            that.ConnectRequest();
        }
        catch (e) {
            // ignore
        }
        that.emit('connect');
        that.emit('connecting');
    });
}

/// <summary>
///     Stop the connection
/// </summary>
KnxConnectionTunneling.prototype.Disconnect = function () {
    try {
        this.TerminateStateRequest();
        this.DisconnectRequest();
        this.knxReceiver.Stop();
        this._udpClient.close();
    }
    catch (e) {
        // ignore
    }
    this.emit('close');
    this.emit('disconnect');
    this.emit('disconnected');
    this.connected = false;
}

KnxConnectionTunneling.prototype.InitializeStateRequest = function () {
    var self = this;
    this._stateRequestTimer = setInterval(function () {
        self.StateRequest();
    }, 60000); // same time as ETS with group monitor open
}

KnxConnectionTunneling.prototype.TerminateStateRequest = function () {
    if (this._stateRequestTimer == null)
        return;
    clearInterval(this._stateRequestTimer);
}

// TODO: I wonder if we can extract all these types of requests
KnxConnectionTunneling.prototype.ConnectRequest = function () {
    // HEADER
    var datagram = new Buffer(26);
    datagram[00] = 0x06;
    datagram[01] = 0x10;
    datagram[02] = 0x02;
    datagram[03] = 0x05;
    datagram[04] = 0x00;
    datagram[05] = 0x1A;

    datagram[06] = 0x08;
    datagram[07] = 0x01;
    datagram[08] = this._localEndpoint.toBytes()[0];
    datagram[09] = this._localEndpoint.toBytes()[1];
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
    this.knxSender.SendDataSingle(datagram);
}

KnxConnectionTunneling.prototype.StateRequest = function (sender, ElapsedEventArgs) {
    // HEADER
    var datagram = new Buffer(16);
    datagram[00] = 0x06;
    datagram[01] = 0x10;
    datagram[02] = 0x02;
    datagram[03] = 0x07;
    datagram[04] = 0x00;
    datagram[05] = 0x10;

    datagram[06] = this.ChannelId;
    datagram[07] = 0x00;
    datagram[08] = 0x08;
    datagram[09] = 0x01;
    datagram[10] = this._localEndpoint.toBytes()[0];
    datagram[11] = this._localEndpoint.toBytes()[1];
    datagram[12] = this._localEndpoint.toBytes()[2];
    datagram[13] = this._localEndpoint.toBytes()[3];
    datagram[14] = (this._localEndpoint.port >> 8) & 255;
    datagram[15] = this._localEndpoint.port & 255;

    try {
        this.knxSender.SendData(datagram);
    }
    catch (e) {
        // ignore
    }
}

KnxConnectionTunneling.prototype.DisconnectRequest = function () {
    // HEADER
    var datagram = new Buffer(16);
    datagram[00] = 0x06;
    datagram[01] = 0x10;
    datagram[02] = 0x02;
    datagram[03] = 0x09;
    datagram[04] = 0x00;
    datagram[05] = 0x10;

    datagram[06] = this.ChannelId;
    datagram[07] = 0x00;
    datagram[08] = 0x08;
    datagram[09] = 0x01;
    datagram[10] = this._localEndpoint.toBytes()[0];
    datagram[11] = this._localEndpoint.toBytes()[1];
    datagram[12] = this._localEndpoint.toBytes()[2];
    datagram[13] = this._localEndpoint.toBytes()[3];
    datagram[14] = (this._localEndpoint.port >> 8) & 255;
    datagram[15] = this._localEndpoint.port & 255;
    this.knxSender.SendData(datagram);
}

module.exports = KnxConnectionTunneling;