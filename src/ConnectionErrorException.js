/**
 * Created by aborovsky on 27.08.2015.
 */
function ConnectionErrorException(msg) {
    Error.apply(this, arguments);
}
ConnectionErrorException.prototype = new Error();

module.exports = ConnectionErrorException;