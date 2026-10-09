const PINTEREST_HOST = /(^|\.)pinterest\.com$/;
const TOGGLE_MESSAGE = { type: 'toggle' };

function isPinterest(url) {
  try {
    return PINTEREST_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function injectContentScript(tabId) {
  await chrome.scripting.insertCSS({ target: { tabId }, files: ['content.css'] });
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
}

async function toggle(tab) {
  if (!tab.id || !isPinterest(tab.url)) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, TOGGLE_MESSAGE);
  } catch {
    await injectContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, TOGGLE_MESSAGE);
  }
}

chrome.action.onClicked.addListener(toggle);

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'state' && sender.tab) {
    chrome.action.setBadgeText({ tabId: sender.tab.id, text: message.enabled ? 'ON' : '' });
  }
});
