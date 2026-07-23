const { Menu, app, BrowserWindow } = require("electron");
const { USE_NATIVE_MENU_BAR } = require("./config");
const { IPC_CHANNELS } = require("../shared/ipc-channels");

function sendProjectHistoryCommand(win, command) {
  const target = BrowserWindow.getFocusedWindow() || win;
  if (!target || target.isDestroyed()) return;
  target.webContents.send(IPC_CHANNELS.PROJECT_HISTORY_COMMAND, command);
}

function configureApplicationMenu(win) {
  if (USE_NATIVE_MENU_BAR) return;

  win.setAutoHideMenuBar(true);

  if (process.platform === "darwin") {
    const template = [
      {
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      },
      {
        label: "Edit",
        submenu: [
          {
            label: "Undo",
            accelerator: "CommandOrControl+Z",
            click: () => sendProjectHistoryCommand(win, "undo"),
          },
          {
            label: "Redo",
            accelerator: "Shift+CommandOrControl+Z",
            click: () => sendProjectHistoryCommand(win, "redo"),
          },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      { role: "windowMenu" },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    return;
  }

  Menu.setApplicationMenu(null);
  win.setMenuBarVisibility(false);
  win.removeMenu();
}

module.exports = {
  configureApplicationMenu,
};
