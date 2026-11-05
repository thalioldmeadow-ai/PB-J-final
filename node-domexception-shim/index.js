if (!globalThis.DOMException) {
  try {
    const { MessageChannel } = require('worker_threads');
    const port = new MessageChannel().port1;
    const ab = new ArrayBuffer();
    port.postMessage(ab, [ab, ab]);
  } catch (err) {
    if (err.constructor.name === 'DOMException') {
      globalThis.DOMException = err.constructor;
    }
  }
}

module.exports = globalThis.DOMException;
