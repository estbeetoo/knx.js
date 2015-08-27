/**
 * Created by aborovsky on 24.08.2015.
 */

var EventEmitter = require('events').EventEmitter;
var util = require('util');
var InvalidKnxDataException = require('./InvalidKnxDataException');

function isInt(n) {
    return Number(n) === n && n % 1 === 0;
}

function isFloat(n) {
    return n === Number(n) && n % 1 !== 0;
}

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
    this.connected = false;

    this.ActionMessageCode = 0x00;
    this.ThreeLevelGroupAddressing = true;
}

util.inherits(KnxConnection, EventEmitter);

/// <summary>
///     Send a byte array value as data to specified address
/// </summary>
/// <param name="address">KNX Address</param>
/// <param name="data">Byte array value or integer</param>
KnxConnection.prototype.Action = function (address, data) {

    if (!Buffer.isBuffer(data)) {
        var buf = null;
        switch (typeof(data)) {
            case 'boolean':
                buf = new Buffer(1);
                buf.writeIntLE(data ? 1 : 0);
                break
            case 'number':
                //if integer
                if (isInt(data)) {
                    buf = new Buffer(2);
                    if (data <= 255) {
                        buf[0] = 0x00;
                        buf[1] = data & 255;
                    }
                    else if (data <= 65535) {
                        buf[0] = data & 255;
                        buf[1] = (data >> 8) & 255;
                    }
                    else
                        throw new InvalidKnxDataException(data.toString());
                }
                //if float
                else if (isFloat(data)) {
                    buf.writeFloatLE(data, 0);
                }
                else
                    throw new InvalidKnxDataException(data.toString());
                break
            case 'string':
                buf = new Buffer(data.toString());
                break
        }
        data = buf;
    }
    if (this.debug)
        console.log("[%s] Sending %s to %s.", this.ClassName, data, address);
    this.knxSender.Action(address, data);
    if (this.debug)
        console.log("[%s] Sent %s to %s.", this.ClassName, data, address);
}

// TODO: It would be good to make a type for address, to make sure not any random string can be passed in
/// <summary>
///     Send a request to KNX asking for specified address current status
/// </summary>
/// <param name="address"></param>
KnxConnection.prototype.RequestStatus = function (address) {
    if (this.debug)
        console.log("[%s] Sending request status to %s.", this.ClassName, address);
    this.knxSender.RequestStatus(address);
    if (this.debug)
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