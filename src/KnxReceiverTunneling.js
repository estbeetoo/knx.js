/**
 * Created by aborovsky on 24.08.2015.
 */
var util = require('util');
var KnxDatagram = require('./KnxDatagram');
var KnxReceiver = require('./KnxReceiver');

function KnxReceiverTunneling(/*KnxConnection*/ connection, /*UdpClient*/ udpClient, /*IPEndPoint*/ localEndpoint) {
    KnxReceiverTunneling.super_.call(this, connection, udpClient, localEndpoint);
    this.connection = connection;
    this._udpClient = udpClient;
    this._localEndpoint = localEndpoint;
    this._rxSequenceNumber = null;
}
util.inherits(KnxReceiverTunneling, KnxReceiver);

KnxReceiverTunneling.prototype.SetClient = function (/*UdpClient*/ client) {
    this._udpClient = client;
}
KnxReceiverTunneling.prototype.Start = function (callback) {
    var that = this;
    this.socketReceiveLstnr = function (msg, rinfo) {
        try {
            that.ProcessDatagram(msg);
        } catch (e) {
            console.error('Error processing KNX incoming datagram[' + msg.toString('hex') + '], cause: ' + e.toLocaleString());
        }
    }
    this._udpClient.on('message', this.socketReceiveLstnr);
    this._udpClient.bind(this._localEndpoint.port, callback);
}
KnxReceiverTunneling.prototype.Stop = function () {
    this._udpClient.removeListener('message', this.socketReceiveLstnr);
}
KnxReceiverTunneling.prototype.ProcessDatagram = function (/*buffer*/ datagram) {
    if (this.connection.debug)
        console.log('ProcessDatagram datagram[%s]', datagram.toString('hex'));
    try {
        switch (KnxHelper.GetServiceType(datagram)) {
            case KnxHelper.SERVICE_TYPE.CONNECT_RESPONSE:
                this.ProcessConnectResponse(datagram);
                break;
            case KnxHelper.SERVICE_TYPE.CONNECTIONSTATE_RESPONSE:
                this.ProcessConnectionStateResponse(datagram);
                break;
            case KnxHelper.SERVICE_TYPE.TUNNELLING_ACK:
                this.ProcessTunnelingAck(datagram);
                break;
            case KnxHelper.SERVICE_TYPE.DISCONNECT_REQUEST:
                this.ProcessDisconnectRequest(datagram);
                break;
            case KnxHelper.SERVICE_TYPE.TUNNELLING_REQUEST:
                this.ProcessDatagramHeaders(datagram);
                break;
            default:
                console.log('Unknown serviceType of datagram[%s]', datagram.toString('hex'));
                break;
        }
    }
    catch (e) {
        console.error('Error processing datagram[' + datagram.toString('hex') + '] inside of KnxReceiverTunneling.prototype.ProcessDatagram, cause: ' + e.toLocaleString());
    }
}

KnxReceiverTunneling.prototype.ProcessDatagramHeaders = function (/*buffer*/ datagram) {
    // HEADER
    // TODO: Might be interesting to take out these magic numbers for the datagram indices
    var service_type = new Buffer(2);
    service_type[0] = datagram[2];
    service_type[1] = datagram[3];
    var knxDatagram = new KnxDatagram({
        header_length: datagram[0],
        protocol_version: datagram[1],
        service_type: service_type,
        total_length: datagram[4] + datagram[5]
    });

    var channelId = datagram[7];
    if (channelId != this.connection.ChannelId)
        return;

    var sequenceNumber = datagram[8];
    var process = true;
    if (sequenceNumber && this._rxSequenceNumber && sequenceNumber <= this._rxSequenceNumber)
        process = false;

    this._rxSequenceNumber = sequenceNumber;

    if (process) {
        // TODO: Magic number 10, what is it?
        var cemi = new Buffer(datagram.length - 10);
        datagram.copy(cemi, 0, 10, datagram.length);
        this.ProcessCEMI(knxDatagram, cemi);
    }

    this.connection.knxSender.SendTunnelingAck(sequenceNumber);
}

KnxReceiverTunneling.prototype.ProcessDisconnectRequest = function (/*buffer*/ datagram) {
    var channelId = datagram[6];
    if (channelId != this.connection.ChannelId)
        return;

    this.stop();
    this.connection.emit('close');
    this._udpClient.close();
}

/*
 TODO: implement ack processing!
 */
KnxReceiverTunneling.prototype.ProcessTunnelingAck = function (/*buffer*/ datagram) {
    // do nothing
}


KnxReceiverTunneling.prototype.ProcessConnectionStateResponse = function (/*buffer*/ datagram) {
    // HEADER
    // 06 10 02 08 00 08 -- 48 21
    var service_type = new Buffer(2);
    service_type[0] = datagram[2];
    service_type[1] = datagram[3];
    var knxDatagram = new KnxDatagram({
        header_length: datagram[0],
        protocol_version: datagram[1],
        service_type: service_type,
        total_length: datagram[4] + datagram[5],
        channel_id: datagram[6]
    });
    var response = datagram[7];
    if (response != 0x21) {
        this.connection.emit('alive');
        return;
    }
    if (this.connection.debug)
        console.log("KnxReceiverTunneling: Received connection state response - No active connection with channel ID %s", knxDatagram.channel_id);
    
    new Promise(function (win) {
        this.connection.Disconnect(win);
    }.bind(this)).then(this.connection.Connect.bind(this.connection));
}

KnxReceiverTunneling.prototype.ProcessConnectResponse = function (/*buffer*/ datagram) {
    // HEADER
    var service_type = new Buffer(2);

    service_type[0] = datagram[2];
    service_type[1] = datagram[3];

    var knxDatagram = new KnxDatagram({
        header_length: datagram[0],
        protocol_version: datagram[1],
        service_type: service_type,
        total_length: datagram[4] + datagram[5],
        channel_id: datagram[6],
        status: datagram[7]
    });

    if (knxDatagram.channel_id == 0x00 && knxDatagram.status == 0x24)
        throw "KnxReceiverTunneling: Received connect response - No more connections available";
    else {
        this.connection.ChannelId = knxDatagram.channel_id;
        this.connection.ResetSequenceNumber();
        this.connection.connected = true;
        this.connection.emit('connected');
    }
}

module.exports = KnxReceiverTunneling;