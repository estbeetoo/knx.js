/**
 * Created by aborovsky on 26.08.2015.
 */
function KnxReceiver(/*KnxConnection*/ connection) {
    this.connection = connection;
}

KnxReceiver.prototype.ProcessCEMI = function (/*KnxDatagram*/ datagram, /*buffer*/ cemi) {
    try {
        // CEMI
        // +--------+--------+--------+--------+----------------+----------------+--------+----------------+
        // |  Msg   |Add.Info| Ctrl 1 | Ctrl 2 | Source Address | Dest. Address  |  Data  |      APDU      |
        // | Code   | Length |        |        |                |                | Length |                |
        // +--------+--------+--------+--------+----------------+----------------+--------+----------------+
        //   1 byte   1 byte   1 byte   1 byte      2 bytes          2 bytes       1 byte      2 bytes
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
        datagram.message_code = cemi[0];
        datagram.additional_info_length = cemi[1];

        if (datagram.additional_info_length > 0) {
            datagram.additional_info = new Buffer(datagram.additional_info_length);
            for (var i = 0; i < datagram.additional_info_length; i++) {
                datagram.additional_info[i] = cemi[2 + i];
            }
        }

        datagram.control_field_1 = cemi[2 + datagram.additional_info_length];
        datagram.control_field_2 = cemi[3 + datagram.additional_info_length];
        var buf = new Buffer(2);
        buf[0] = cemi[4 + datagram.additional_info_length];
        buf[1] = cemi[5 + datagram.additional_info_length];
        datagram.source_address = KnxHelper.GetIndividualAddress(buf);

        buf = new Buffer(2);
        buf[0] = cemi[6 + datagram.additional_info_length];
        buf[1] = cemi[7 + datagram.additional_info_length];

        datagram.destination_address =
            (KnxHelper.GetKnxDestinationAddressType(datagram.control_field_2) === KnxHelper.KnxDestinationAddressType.INDIVIDUAL) ?
                KnxHelper.GetIndividualAddress(buf) :
                KnxHelper.GetGroupAddress(buf, this.connection.ThreeLevelGroupAddressing);

        datagram.data_length = cemi[8 + datagram.additional_info_length];
        datagram.apdu = new Buffer(datagram.data_length + 1);

        for (var i = 0; i < datagram.apdu.length; i++)
            datagram.apdu[i] = cemi[9 + i + datagram.additional_info_length];

        datagram.data = KnxHelper.GetData(datagram.data_length, datagram.apdu);

        if (this.connection.debug) {
            console.log("-----------------------------------------------------------------------------------------------------");
            console.log(cemi.toString('hex'));
            console.log("Event Header Length: " + datagram.header_length);
            console.log("Event Protocol Version: " + datagram.protocol_version);
            console.log("Event Service Type: 0x" + datagram.service_type.toString('hex'));
            console.log("Event Total Length: " + datagram.total_length);

            console.log("Event Message Code: " + datagram.message_code);
            console.log("Event Aditional Info Length: " + datagram.additional_info_length);

            if (datagram.additional_info_length > 0)
                console.log("Event Aditional Info: 0x" + datagram.additional_info.toString('hex'));

            console.log("Event Control Field 1: " + datagram.control_field_1);
            console.log("Event Control Field 2: " + datagram.control_field_2);
            console.log("Event Source Address: " + datagram.source_address);
            console.log("Event Destination Address: " + datagram.destination_address);
            console.log("Event Data Length: " + datagram.data_length);
            console.log("Event APDU: 0x" + datagram.apdu.toString('hex'));
            console.log("Event Data: " + datagram.data.toString('hex'));
            console.log("-----------------------------------------------------------------------------------------------------");
        }

        if (datagram.message_code != 0x29)
            return;

        var type = datagram.apdu[1] >> 4;

        switch (type) {
            case 8:
                this.connection.emit('event', datagram.destination_address, datagram.data, datagram);
                this.connection.emit('event.' + datagram.destination_address.toString(), datagram.destination_address, datagram.data, datagram);
                break;
            case 4:
                this.connection.emit('status', datagram.destination_address, datagram.data, datagram);
                this.connection.emit('status.' + datagram.destination_address.toString(), datagram.destination_address, datagram.data, datagram);
                break;
            default:
                console.log('Unknown type[' + type + '] received in datagram[' + datagram.data.toString('hex') + ']');
                break;
        }
    }
    catch (e) {
        // ignore, missing warning information
    }
}

module.exports = KnxReceiver;