/**
 * Created by aborovsky on 27.08.2015.
 */
function InvalidKnxAddressException(msg) {
    Error.apply(this, arguments);
}
InvalidKnxAddressException.prototype = new Error();

module.exports = InvalidKnxAddressException;