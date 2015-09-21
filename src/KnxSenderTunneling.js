/**
 * Created by aborovsky on 24.08.2015.
 */
var util = require('util');
var KnxSender = require('./KnxSender');

function KnxSenderTunneling(/*KnxConnection*/ connection, udpClient, remoteEndpoint) {
    KnxSenderTunneling.super_.call(this, connection, udpClient, remoteEndpoint);
    this.connection = connection;
    this._udpClient = udpClient;
    this._remoteEndpoint = remoteEndpoint;
}
util.inherits(KnxSenderTunneling, KnxSender);

KnxSenderTunneling.prototype.SetClient = function (/*UdpClient*/ client) {
    this._udpClient = client;
}

KnxSenderTunneling.prototype.SendDataSingle = function (/*buffer*/ datagram, callback) {
    var that = this;

    function cb(err) {
        if (that.connection.debug)
            console.log('udp sent, err[' + (err ? err.toString() : 'no_err') + ']');
        callback && callback();
    }

    this._udpClient.send(datagram, 0, datagram.length, this._remoteEndpoint.port, this._remoteEndpoint.host, cb)
}

/*
 WTF? Why we send 4 times?
 */
KnxSenderTunneling.prototype.SendData = function (/*buffer*/datagram, callback) {
    var that = this;

    function cb(err) {
        if (that.connection.debug)
            console.log('udp sent, err[' + (err ? err.toString() : 'no_err') + ']');
        callback && callback();
    }

    this._udpClient.send(datagram, 0, datagram.length, this._remoteEndpoint.port, this._remoteEndpoint.host, cb);
    //this._udpClient.send(datagram, 0, datagram.length, this._remoteEndpoint.port, this._remoteEndpoint.host, callback);
    //this._udpClient.send(datagram, 0, datagram.length, this._remoteEndpoint.port, this._remoteEndpoint.host, callback);
    //this._udpClient.send(datagram, 0, datagram.length, this._remoteEndpoint.port, this._remoteEndpoint.host, callback);
}

KnxSenderTunneling.prototype.SendTunnelingAck = function (sequenceNumber) {
    // HEADER
    var datagram = new Buffer(10);
    datagram[00] = 0x06;
    datagram[01] = 0x10;
    datagram[02] = 0x04;
    datagram[03] = 0x21;
    datagram[04] = 0x00;
    datagram[05] = 0x0A;

    datagram[06] = 0x04;
    datagram[07] = this.connection.ChannelId;
    datagram[08] = sequenceNumber;
    datagram[09] = 0x00;

    this._udpClient.send(datagram, 0, datagram.length, this._remoteEndpoint.port, this._remoteEndpoint.host);
}

KnxSenderTunneling.prototype.CreateActionDatagram = function (/*string*/ destinationAddress, /*buffer*/ data) {
    try {
        var dataLength = KnxHelper.GetDataLength(data);

        // HEADER
        var datagram = new Buffer(10);
        datagram[00] = 0x06;
        datagram[01] = 0x10;
        datagram[02] = 0x04;
        datagram[03] = 0x20;

        var totalLength = dataLength + 20;
        var buf = new Buffer(2);
        buf.writeUInt16LE(totalLength);
        datagram[04] = buf[1];
        datagram[05] = buf[0];

        datagram[06] = 0x04;
        datagram[07] = this.connection.ChannelId;
        datagram[08] = this.connection.GenerateSequenceNumber();
        datagram[09] = 0x00;

        return this.CreateActionDatagramCommon(destinationAddress, data, datagram);
    }
    catch (e) {
        this.connection.RevertSingleSequenceNumber();

        return null;
    }
}

KnxSenderTunneling.prototype.CreateRequestStatusDatagram = function (/*string*/ destinationAddress) {
    try {
        // HEADER
        var datagram = new Buffer(21);
        datagram[00] = 0x06;
        datagram[01] = 0x10;
        datagram[02] = 0x04;
        datagram[03] = 0x20;
        datagram[04] = 0x00;
        datagram[05] = 0x15;

        datagram[06] = 0x04;
        datagram[07] = this.connection.ChannelId;
        datagram[08] = this.connection.GenerateSequenceNumber();
        datagram[09] = 0x00;

        return this.CreateRequestStatusDatagramCommon(destinationAddress, datagram, 10);
    }
    catch (e) {
        this.connection.RevertSingleSequenceNumber();
        return null;
    }
}

module.exports = KnxSenderTunneling;