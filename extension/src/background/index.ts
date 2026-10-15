// The background service worker is deliberately thin. Chrome may stop it at
// any time, so no long-running work lives here (see docs/ARCHITECTURE.md).

function enablePanelOnIconClick() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err: unknown) => console.error('[HirePilot] setPanelBehavior failed', err));
}

chrome.runtime.onInstalled.addListener(enablePanelOnIconClick);
chrome.runtime.onStartup.addListener(enablePanelOnIconClick);
