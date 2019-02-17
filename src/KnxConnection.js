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
    this.debug = false;

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
/*
 Datatypes

 KNX/EIB Function                   Information length      EIS         DPT     Value
 Switch                             1 Bit                   EIS 1       DPT 1	0,1
 Dimming (Position, Control, Value) 1 Bit, 4 Bit, 8 Bit     EIS 2	    DPT 3	[0,0]...[1,7]
 Time                               3 Byte                  EIS 3	    DPT 10
 Date                               3 Byte                  EIS 4       DPT 11
 Floating point                     2 Byte                  EIS 5	    DPT 9	-671088,64 - 670760,96
 8-bit unsigned value               1 Byte                  EIS 6	    DPT 5	0...255
 8-bit unsigned value               1 Byte                  DPT 5.001	DPT 5.001	0...100
 Blinds / Roller shutter            1 Bit                   EIS 7	    DPT 1	0,1
 Priority                           2 Bit                   EIS 8	    DPT 2	[0,0]...[1,1]
 IEEE Floating point                4 Byte                  EIS 9	    DPT 14	4-Octet Float Value IEEE 754
 16-bit unsigned value              2 Byte                  EIS 10	    DPT 7	0...65535
 16-bit signed value                2 Byte                  DPT 8	    DPT 8	-32768...32767
 32-bit unsigned value              4 Byte                  EIS 11	    DPT 12	0...4294967295
 32-bit signed value                4 Byte                  DPT 13	    DPT 13	-2147483648...2147483647
 Access control                     1 Byte                  EIS 12	    DPT 15
 ASCII character                    1 Byte                  EIS 13	    DPT 4
 8859_1 character                   1 Byte                  DPT 4.002	DPT 4.002
 8-bit signed value                 1 Byte                  EIS 14	    DPT 6	-128...127
 14 character ASCII                 14 Byte                 EIS 15	    DPT 16
 14 character 8859_1                14 Byte                 DPT 16.001	DPT 16.001
 Scene                              1 Byte                  DPT 17	    DPT 17	0...63
 HVAC                               1 Byte                  DPT 20	    DPT 20	0..255
 Unlimited string 8859_1            .                       DPT 24	    DPT 24
 List 3-byte value                  3 Byte                  DPT 232	    DPT 232	RGB[0,0,0]...[255,255,255]
 */
KnxConnection.prototype.Action = function (address, data, callback) {
    if (!Buffer.isBuffer(data)) {
        var buf = null;
        switch (typeof(data)) {
            case 'boolean':
                buf = new Buffer(1);
                buf.writeInt8(data ? 1 : 0, 0);
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
                    buf = new Buffer(4);
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
        console.log("[%s] Sending %s to %s.", this.ClassName, JSON.stringify(data), JSON.stringify(address));
    this.knxSender.Action(address, data, callback);
    if (this.debug)
        console.log("[%s] Sent %s to %s.", this.ClassName, JSON.stringify(data), JSON.stringify(address));
}

// TODO: It would be good to make a type for address, to make sure not any random string can be passed in
/// <summary>
///     Send a request to KNX asking for specified address current status
/// </summary>
/// <param name="address"></param>
KnxConnection.prototype.RequestStatus = function (address, callback) {
    if (this.debug)
        console.log("[%s] Sending request status to %s.", this.ClassName, JSON.stringify(address));
    this.knxSender.RequestStatus(address, callback);
    if (this.debug)
        console.log("[%s] Sent request status to %s.", this.ClassName, JSON.stringify(address));
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
