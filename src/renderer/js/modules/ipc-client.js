const { ipcRenderer } = require('electron');

class IpcClient {
  on(channel, listener) {
    ipcRenderer.on(channel, listener);
  }

  invoke(channel, payload) {
    return ipcRenderer.invoke(channel, payload);
  }

  send(channel, payload) {
    ipcRenderer.send(channel, payload);
  }
}

module.exports = IpcClient;
