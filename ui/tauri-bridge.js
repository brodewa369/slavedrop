// SlaveDrop — Tauri API bridge.
// Exposes window.api with the SAME surface as the Electron preload.js,
// backed by Tauri v2 IPC commands (see src-tauri/src/lib.rs).
(function () {
  'use strict';

  const invoke = window.__TAURI__.core.invoke;

  const api = {
    options: () => invoke('db_options'),
    addOption: (key, value) => invoke('db_option_add', { key, value }),
    setOption: (key, arr) => invoke('db_option_set', { key, arr }),
    optionUsage: (key, value) => invoke('db_option_usage', { key, value }),
    deleteOption: (key, value) => invoke('db_option_delete', { key, value }),
    settingsGet: () => invoke('db_settings_get'),
    settingsSet: (patch) => invoke('db_settings_set', { patch }),
    strings: () => invoke('db_t'),
    projects: () => invoke('db_projects'),
    getProject: (id) => invoke('db_project_get', { id }),
    saveProject: (data) => invoke('db_project_save', { data }),
    deleteProject: (id) => invoke('db_project_delete', { id }),
    toggleProject: (id, done) => invoke('db_project_toggle', { id, done }),
    toggleTask: (projectId, taskId, done) => invoke('db_task_toggle', { projectId, taskId, done }),
    setIcon: (id, iconPath) => invoke('db_project_icon', { id, iconPath }),
    pickIcon: () => invoke('dialog_pick_icon'),
    pickBg: () => invoke('dialog_pick_bg'),
    deadlines: () => invoke('db_deadlines'),
    stats: () => invoke('db_stats'),
    backup: () => invoke('db_backup'),
    restore: () => invoke('db_restore'),
    openUrl: (url) => invoke('shell_open', { url }),
    openX: (username) => invoke('shell_x', { username }),
    parseX: (v) => invoke('parse_x', { v }),
    copy: (text) => invoke('clipboard_write', { text: String(text || '') }),
    // native confirm dialog (Tauri webview has no window.confirm)
    confirmDialog: async (message) => {
      const r = await invoke('confirm_dialog', { message });
      return r === true;
    },
  };

  window.api = api;
})();
