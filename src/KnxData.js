/**
 * Created by aborovsky on 24.08.2015.
 */

function KnxData(apdu) {

    this.ClassName = 'KnxData';
    this.apdu = apdu;
}

/// <summary>
///    Represent data send over knx bus and provide methods to interpret them as different dpt values
/// </summary>
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

/// <summary>
///     Prepare the internal data to access it as specific type
/// </summary>
/// <returns>DataView object</returns>
KnxData.prototype.dataView = function () {
    var i;
    var len = this.apdu.length - 2;
    this.buffer = new ArrayBuffer(len);
    dataView = new DataView(this.buffer);
    for(i = 0; i < len; i++) {
        dataView.setUint8(i, this.apdu[i+2]);
    }
    return dataView;
};

/// <summary>
///     Interpret the underlying data as boolean value
/// </summary>
/// <returns></returns>
KnxData.prototype.asDpt1 = function () {
    var data = 0x3F & this.apdu[1]
    return (data != 0);
};

/// <summary>
///     Interpret the underlying data as 1 Byte unsigned value
/// </summary>
/// <returns></returns>
KnxData.prototype.asDpt5 = function () {
    view = this.dataView();
    return view.getUint8(0);
};

/// <summary>
///     Interpret the underlying data as 2 byte floating point value
/// </summary>
/// <returns></returns>
KnxData.prototype.asDpt9 = function () {
    var sign     =  this.apdu[2] >> 7;
    var exponent = (this.apdu[2] & 0b01111000) >> 3;
    var mantissa = 256 * (this.apdu[2] & 0b00000111) + this.apdu[3];
    mantissa = (sign == 1) ? ~(mantissa^2047) : mantissa;

    return KnxHelper.ldexp((0.01*mantissa), exponent);
};

module.exports = KnxData;
