/**
 * Created by aborovsky on 25.08.2015.
 */
function KnxSender(/*KnxConnection*/ connection) {
    this.connection = connection;
}

KnxSender.prototype.Action = function (destinationAddress, /*buffer*/ data, callback) {
    this.SendData(this.CreateActionDatagram(destinationAddress, data), callback);
}

KnxSender.prototype.RequestStatus = function (destinationAddress, callback) {
    callback && this.connection.once('status.' + destinationAddress.toString(), callback);
    this.SendData(this.CreateRequestStatusDatagram(destinationAddress));
}

KnxSender.prototype.CreateActionDatagramCommon = function (destinationAddress, /*buffer*/data, /*buffer*/header) {
    var i;
    var dataLength = KnxHelper.GetDataLength(data);

    // HEADER
    var datagram = new Buffer(dataLength + 10 + header.length);
    for (i = 0; i < header.length; i++)
        datagram[i] = header[i];

    // CEMI (start at position 6)
    // +--------+--------+--------+--------+----------------+----------------+--------+----------------+
    // |  Msg   |Add.Info| Ctrl 1 | Ctrl 2 | Source Address | Dest. Address  |  Data  |      APDU      |
    // | Code   | Length |        |        |                |                | Length |                |
    // +--------+--------+--------+--------+----------------+----------------+--------+----------------+
    59//   1 byte   1 byte   1 byte   1 byte      2 bytes          2 bytes       1 byte      2 bytes
    //
    //  Message Code    = 0x11 - a L_Data.req primitive
    //      COMMON EMI MESSAGE CODES FOR DATA LINK LAYER PRIMITIVES
    //          FROM NETWORK LAYER TO DATA LINK LAYER
    //          +---------------------------+--------------+-------------------------+---------------------+------------------+
    //          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description | Common EMI Frame |
    //          +---------------------------+--------------+-------------------------+---------------------+------------------+
    //          |        L_Raw.req          |    0x10      |                         |                     |                  |
    //          +---------------------------+--------------+-------------------------+---------------------+------------------+
    //          |                           |              |                         | Primitive used for  | Sample Common    |
    //          |        L_Data.req         |    0x11      |      Data Service       | transmitting a data | EMI frame        |
    //          |                           |              |                         | frame               |                  |
    //          +---------------------------+--------------+-------------------------+---------------------+------------------+
    //          |        L_Poll_Data.req    |    0x13      |    Poll Data Service    |                     |                  |
    //          +---------------------------+--------------+-------------------------+---------------------+------------------+
    //          |        L_Raw.req          |    0x10      |                         |                     |                  |
    //          +---------------------------+--------------+-------------------------+---------------------+------------------+
    //          FROM DATA LINK LAYER TO NETWORK LAYER
    //          +---------------------------+--------------+-------------------------+---------------------+
    //          | Data Link Layer Primitive | Message Code | Data Link Layer Service | Service Description |
    //          +---------------------------+--------------+-------------------------+---------------------+
    //          |        L_Poll_Data.con    |    0x25      |    Poll Data Service    |                     |
    //          +---------------------------+--------------+-------------------------+---------------------+
    //          |                           |              |                         | Primitive used for  |
    //          |        L_Data.ind         |    0x29      |      Data Service       | receiving a data    |
    //          |                           |              |                         | frame               |
    //          +---------------------------+--------------+-------------------------+---------------------+
    //          |        L_Busmon.ind       |    0x2B      |   Bus Monitor Service   |                     |
    //          +---------------------------+--------------+-------------------------+---------------------+
    //          |        L_Raw.ind          |    0x2D      |                         |                     |
    //          +---------------------------+--------------+-------------------------+---------------------+
    //          |                           |              |                         | Primitive used for  |
    //          |                           |              |                         | local confirmation  |
    //          |        L_Data.con         |    0x2E      |      Data Service       | that a frame was    |
    //          |                           |              |                         | sent (does not mean |
    //          |                           |              |                         | successful receive) |
    //          +---------------------------+--------------+-------------------------+---------------------+
    //          |        L_Raw.con          |    0x2F      |                         |                     |
    //          +---------------------------+--------------+-------------------------+---------------------+

    //  Add.Info Length = 0x00 - no additional info
    //  Control Field 1 = see the bit structure above
    //  Control Field 2 = see the bit structure above
    //  Source Address  = 0x0000 - filled in by router/gateway with its source address which is
    //                    part of the KNX subnet
    //  Dest. Address   = KNX group or individual address (2 byte)
    //  Data Length     = Number of bytes of data in the APDU excluding the TPCI/APCI bits
    //  APDU            = Application Protocol Data Unit - the actual payload including transport
    //                    protocol control information (TPCI), application protocol control
    //                    information (APCI) and data passed as an argument from higher layers of
    //                    the KNX communication stack
    //

    datagram[i++] = this.connection.ActionMessageCode != 0x00 ? this.connection.ActionMessageCode : (0x11 & 255);
    datagram[i++] = 0x00;
    datagram[i++] = 0xAC;
    datagram[i++] = KnxHelper.IsAddressIndividual(destinationAddress) ? (0x50 & 255) : 0xF0;
    datagram[i++] = 0x00;
    datagram[i++] = 0x00;
    var dst_address = KnxHelper.GetAddress(destinationAddress);
    datagram[i++] = dst_address[0];
    datagram[i++] = dst_address[1];
    datagram[i++] = dataLength & 255;
    datagram[i++] = 0x00;
    datagram[i] = 0x80;
    KnxHelper.WriteData(datagram, data, i);
    this.connection.debug && console.log('KnxSender.CreateActionDatagramCommon datagram[%s]', datagram.toString('hex'));
    return datagram;
}

KnxSender.prototype.CreateRequestStatusDatagramCommon = function (destinationAddress, /*buffer*/datagram, cemi_start_pos) {
    var i = 0;

    datagram[cemi_start_pos + i++] = this.connection.ActionMessageCode != 0x00 ? this.connection.ActionMessageCode : (0x11 & 255);

    datagram[cemi_start_pos + i++] = 0x00;
    datagram[cemi_start_pos + i++] = 0xAC;

    datagram[cemi_start_pos + i++] = KnxHelper.IsAddressIndividual(destinationAddress) ? (0x50 & 255) : (0xF0 & 255);

    datagram[cemi_start_pos + i++] = 0x00;
    datagram[cemi_start_pos + i++] = 0x00;
    dst_address = KnxHelper.GetAddress(destinationAddress);
    datagram[cemi_start_pos + i++] = dst_address[0];
    datagram[cemi_start_pos + i++] = dst_address[1];

    datagram[cemi_start_pos + i++] = 0x01;
    datagram[cemi_start_pos + i++] = 0x00;
    datagram[cemi_start_pos + i] = 0x00;

    this.connection.debug && console.log('KnxSender.CreateRequestStatusDatagramCommon datagram[%s]', datagram.toString('hex'));
    return datagram;
}

module.exports = KnxSender;