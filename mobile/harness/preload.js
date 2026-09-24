// preload for the mobile-debug harness: exposes a mock window.api mirroring
// the real SlaveDrop preload.js surface, backed by in-memory seeded data.
const { contextBridge, ipcRenderer } = require('electron');

console.log('[PRELOAD] running, ipcRenderer=', typeof ipcRenderer, 'contextBridge=', typeof contextBridge);

const invoke = (channel) => (...args) => {
  console.log('[PRELOAD] invoke', channel, 'args=', args);
  return ipcRenderer.invoke(channel, ...args).then(r => {
    console.log('[PRELOAD', channel, 'result=', typeof r, JSON.stringify(r).slice(0,80));
    return r;
  }).catch(e => {
    console.error('[PRELOAD] invoke error', channel, e.message);
    throw e;
  });
};

contextBridge.exposeInMainWorld('api', {
  options: invoke('mock:options'),
  addOption: invoke('mock:option:add'),
  setOption: invoke('mock:option:set'),
  optionUsage: invoke('mock:option:usage'),
  deleteOption: invoke('mock:option:delete'),
  settingsGet: invoke('mock:settings:get'),
  settingsSet: invoke('mock:settings:set'),
  strings: invoke('mock:t'),
  projects: invoke('mock:projects'),
  getProject: invoke('mock:project:get'),
  saveProject: invoke('mock:project:save'),
  deleteProject: invoke('mock:project:delete'),
  toggleProject: invoke('mock:project:toggle'),
  toggleTask: invoke('mock:task:toggle'),
  toggleAllTasks: invoke('mock:task:toggleAll'),
  setIcon: invoke('mock:project:icon'),
  pickIcon: invoke('mock:dialog:pickIcon'),
  pickBg: invoke('mock:dialog:pickBg'),
  deadlines: invoke('mock:deadlines'),
  stats: invoke('mock:stats'),
  backup: invoke('mock:backup'),
  restore: invoke('mock:restore'),
  openUrl: invoke('mock:shell:open'),
  openX: invoke('mock:shell:x'),
  parseX: invoke('mock:parse:x'),
  copy: invoke('mock:clipboard:write'),
});
