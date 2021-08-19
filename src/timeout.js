const Promise = require('promise');

module.exports = (fn, timeout, msg = 'timeouted') => Promise.race([
  new Promise((resolve, reject) => setTimeout(() => reject(new Error(msg)), timeout)),
  new Promise((resolve, reject) => {
    try {
      fn(resolve, reject);
    } catch (err) {
      reject(err);
    }
  })
]);
