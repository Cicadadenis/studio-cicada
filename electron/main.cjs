const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

let mainWindow;

app.setName('Cicada Studio');

function getStartUrl() {
  if (process.env.ELECTRON_START_URL) {
    return process.env.ELECTRON_START_URL;
  }

  return pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString();
}

function quitApp() {
  if (!app.isQuitting) {
    app.isQuitting = true;
    app.quit();
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    fullscreen: true,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#05070d',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && input.type === 'keyDown') {
      event.preventDefault();
      quitApp();
    }
  });

  mainWindow.loadURL(getStartUrl());
}

app.whenReady().then(() => {
  createWindow();

  globalShortcut.register('Escape', quitApp);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  quitApp();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
