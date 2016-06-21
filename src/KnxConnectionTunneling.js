/**
 * Created by aborovsky on 24.08.2015.
 */

var CONNECT_TIMEOUT = 5000;
var KnxConnection = require('./KnxConnection');
var KnxReceiverTunneling = require('./KnxReceiverTunneling');
var KnxSenderTunneling = require('./KnxSenderTunneling');
var ConnectionErrorException = require('./ConnectionErrorException');
var util = require('util');
var dgram = require('dgram');
var Promise = require('promise');


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

KnxConnectionTunneling.prototype.ClearReconnectTimeout = function () {
    var that = this;

    if (that.reConnectTimeout) {
        clearTimeout(that.reConnectTimeout);
        delete that.reConnectTimeout;
    }
}

KnxConnectionTunneling.prototype.ClearConnectTimeout = function () {
    var that = this;

    if (that.connectTimeout) {
        clearTimeout(that.connectTimeout);
        delete that.connectTimeout;
    }
}

/// <summary>
///     Start the connection
/// </summary>
KnxConnectionTunneling.prototype.Connect = function (callback) {
    var that = this;

    if (this.connected && this._udpClient) {
        callback && callback();
        return true;
    }

    this.connectTimeout = setTimeout(function () {
        that.removeListener('connected', that.ClearConnectTimeout);
        that.Disconnect(function () {
            if (that.debug)
                console.log('Error connecting: timeout');
            callback && callback({msg: 'Error connecting: timeout', reason: 'CONNECTTIMEOUT'});
            that.ClearReconnectTimeout();
            this.reConnectTimeout = setTimeout(function () {
                if (that.debug)
                    console.log('reconnecting');
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
    new Promise(function (fulfill, reject) {
        that.knxReceiver.Start(fulfill);
    })
        .
        then(function () {
            that.InitializeStateRequest();
        })
        .then(function () {
            that.ConnectRequest();
        })
        .then(function () {
            that.emit('connect');
            that.emit('connecting');
        });
}

/// <summary>
///     Stop the connection
/// </summary>
KnxConnectionTunneling.prototype.Disconnect = function (callback) {
    var that = this;

    that.ClearConnectTimeout();
    that.ClearReconnectTimeout();

    if (callback)
        that.once('disconnect', callback);

    try {
        this.TerminateStateRequest();
        new Promise(function (fulfill, reject) {
            that.DisconnectRequest(fulfill);
        })
            .then(function () {
                that.knxReceiver.Stop();
                that._udpClient.close();
                that.connected = false;
                that.emit('close');
                that.emit('disconnect');
                that.emit('disconnected');
            })

    }
    catch (e) {
        that.emit('disconnect', e);
    }

}

function delay(time) {
    return new Promise(function (fulfill, reject) {
        setTimeout(fulfill, time);
    });
}

function timeout(func, time, timeoutFunc) {

    var success = null;

    var succPromise = new Promise(function (fulfill, reject) {
        func(function () {
            if (success === null) {
                fulfill();
                success = true;
            }
            else
                reject();
        });
    });

    var timeoutPromise = delay(time);

    timeoutPromise.then(function () {
        if (!success)
            return timeoutFunc && timeoutFunc();
    });

    return Promise.race([succPromise, timeoutPromise]);
}

KnxConnectionTunneling.prototype.InitializeStateRequest = function () {
    var self = this;
    this._stateRequestTimer = setInterval(function () {
        timeout(function (fulfill) {
            self.removeAllListeners('alive');
            self.StateRequest(function (err) {
                if (!err)
                    self.once('alive', fulfill);
            });
        }, 2 * CONNECT_TIMEOUT, function () {
            if (self.debug)
                console.log('connection stale, so disconnect and then try to reconnect again');
            new Promise(function (fulfill) {
                self.Disconnect(fulfill);
            }).then(function () {
                    self.Connect();
                });
        });
    }, 60000); // same time as ETS with group monitor open
}

KnxConnectionTunneling.prototype.TerminateStateRequest = function () {
    if (this._stateRequestTimer == null)
        return;
    clearTimeout(this._stateRequestTimer);
}

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
    }
    catch (e) {
        callback && callback();
    }
}

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
    }
    catch (e) {
        callback(e)
    }
}

KnxConnectionTunneling.prototype.DisconnectRequest = function (callback) {
    if(!this.connected) {
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
    }
    catch (e) {
        callback(e)
    }
}

module.exports = KnxConnectionTunneling;
