/**
 * Created by aborovsky on 24.08.2015.
 */

var EventEmitter = require('events').EventEmitter;
var util = require('util');

function KnxConnection(host, port) {

    KnxConnection.super_.call(this);

    this.ClassName = 'KnxConnection';
    this.RemoteEndpoint = {
        host: host,
        port: port,
        toBytes: function () {
            if (!this.host || this.host === '')
                throw 'Cannot proceed toString for endPoint with empy host'
            if (this.host.indexOf('.') === -1 || this.host.split('.').length < 4)
                throw 'Cannot proceed toString for endPoint with host[' + this.host + '], it should contain ip address'
            var result = new Buffer(4);
            var arr = this.host.split('.');
            result[0] = parseInt(arr[0]) & 255;
            result[1] = parseInt(arr[1]) & 255;
            result[2] = parseInt(arr[2]) & 255;
            result[3] = parseInt(arr[3]) & 255;
        }
    };

    this.ActionMessageCode = 0x00;
    this.ThreeLevelGroupAddressing = true;
}

util.inherits(KnxConnection, EventEmitter);

/// <summary>
///     Send an int value as data to specified address
/// </summary>
/// <param name="address">KNX Address</param>
/// <param name="data">Int value</param>
/// <exception cref="InvalidKnxDataException"></exception>
KnxConnection.prototype.Action = function (address, data) {
    var val = new Buffer(2);
    if (data <= 255) {
        val[0] = 0x00;
        val[1] = data & 255;
    }
    else if (data <= 65535) {
        val[0] = data & 255;
        val[1] = (data >> 8) & 255;
    }
    else {
        // allowing only positive integers less than 65535 (2 bytes), maybe it is incorrect...???
        throw new InvalidKnxDataException(data.toString());
    }

    if (val == null)
        throw new InvalidKnxDataException(data.toString());

    this.Action(address, val);
}

/// <summary>
///     Send a byte array value as data to specified address
/// </summary>
/// <param name="address">KNX Address</param>
/// <param name="data">Byte array value</param>
KnxConnection.prototype.Action = function (address, data) {

    if (!Buffer.isBuffer(data)) {
        var buf = null;
        switch (typeof(data)) {
            case 'boolean':
                buf = new Buffer(1);
                buf.writeIntLE(data ? 1 : 0);
                break
            case 'number':
                buf = new Buffer();
                buf.writeIntLE(data);
                break
            case 'string':
                buf = new Buffer(data.toString());
                break
        }
        data = buf;
    }
    console.log("[%s] Sending %s to %s.", this.ClassName, data, address);
    this.knxSender.Action(address, data);
    console.log("[%s] Sent %s to %s.", this.ClassName, data, address);
}

// TODO: It would be good to make a type for address, to make sure not any random string can be passed in
/// <summary>
///     Send a request to KNX asking for specified address current status
/// </summary>
/// <param name="address"></param>
KnxConnection.prototype.RequestStatus = function (address) {
    console.log("[%s] Sending request status to %s.", this.ClassName, address);
    this.knxSender.RequestStatus(address);
    console.log("[%s] Sent request status to %s.", this.ClassName, address);
}

/// <summary>
///     Convert a value received from KNX using datapoint translator, e.g.,
///     get a temperature value in Celsius
/// </summary>
/// <param name="type">Datapoint type, e.g.: 9.001</param>
/// <param name="data">Data to convert</param>
/// <returns></returns>
KnxConnection.prototype.FromDataPoint = function (type, /*buffer*/data) {
    return DataPointTranslator.Instance.FromDataPoint(type, data);
}

/// <summary>
///     Convert a value received from KNX using datapoint translator, e.g.,
///     get a temperature value in Celsius
/// </summary>
/// <param name="type">Datapoint type, e.g.: 9.001</param>
/// <param name="data">Data to convert</param>
/// <returns></returns>
KnxConnection.prototype.FromDataPoint = function (type, /*buffer*/data) {
    return DataPointTranslator.Instance.FromDataPoint(type, data);
}

/// <summary>
///     Convert a value to send to KNX using datapoint translator, e.g.,
///     get a temperature value in Celsius in a byte representation
/// </summary>
/// <param name="type">Datapoint type, e.g.: 9.001</param>
/// <param name="value">Value to convert</param>
/// <returns></returns>
KnxConnection.prototype.ToDataPoint = function (type, value) {
    return DataPointTranslator.Instance.ToDataPoint(type, value);
}

module.exports = KnxConnection;