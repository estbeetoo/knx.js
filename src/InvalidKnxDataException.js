/**
 * Created by aborovsky on 27.08.2015.
 */
function InvalidKnxDataException(msg) {
    Error.apply(this, arguments);
}
InvalidKnxDataException.prototype = new Error();

module.exports = InvalidKnxDataException;