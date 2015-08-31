/**
 * Created by aborovsky on 25.08.2015.
 */
function KnxDatagram(options)
{
    // HEADER
    /*int*/     this.header_length = options.header_length;
    /*byte*/    this.protocol_version = options.protocol_version;
    /*byte[]*/  this.service_type = options.service_type;
    /*int*/     this.total_length = options.total_length;

    // CONNECTION
    /*byte*/    this.channel_id = options.channel_id;
    /*byte*/    this.status = options.status;

    // CEMI
    /*byte*/    this.message_code = options.message_code;
    /*int*/     this.additional_info_length = options.additional_info_length;
    /*byte[]*/  this.additional_info = options.additional_info;
    /*byte*/    this.control_field_1 = options.control_field_1;
    /*byte*/    this.control_field_2 = options.control_field_2;
    /*string*/  this.source_address = options.source_address;
    /*string*/  this.destination_address = options.destination_address;
    /*int*/     this.data_length = options.data_length;
    /*byte[]*/  this.apdu = options.apdu;
    /*string*/  this.data = options.data;
}
module.exports = KnxDatagram;