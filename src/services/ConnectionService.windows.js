/**
 * ConnectionService for Windows — no foreground service needed.
 * On desktop, the app runs normally without Android's background restrictions.
 */

class ConnectionServiceHelper {
  async start() {
    console.log('[ConnectionService] Windows — foreground service not needed');
    return true;
  }

  async stop() {
    return true;
  }

  async isRunning() {
    return true; // Always "running" on desktop
  }
}

export default new ConnectionServiceHelper();
