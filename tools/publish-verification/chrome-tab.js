function run([platform]) {
  const pages = {
    douyin: ['https://creator.douyin.com/creator-micro/home', 'https://creator.douyin.com/creator-micro/content/manage'],
    wechat: ['https://mp.weixin.qq.com/', 'https://mp.weixin.qq.com/cgi-bin/home', 'https://mp.weixin.qq.com/cgi-bin/appmsgpublish']
  };
  if (!Object.hasOwn(pages, platform)) return 'unsupported';
  const chrome = Application('Google Chrome');
  if (!chrome.running()) return 'closed';
  const windows = chrome.windows();
  if (!windows.length) return 'no-window';
  const [home] = pages[platform];
  const matches = url => typeof url === 'string' && pages[platform].some(page => url.split(/[?#]/, 1)[0] === page);
  for (const window of windows) {
    if (window.mode() !== 'normal') continue;
    const tabs = window.tabs();
    const index = tabs.findIndex(tab => matches(tab.url()));
    if (index === -1) continue;
    window.index = 1;
    window.activeTabIndex = index + 1;
    if (tabs[index].url().split(/[?#]/, 1)[0] !== home &&
        !(platform === 'wechat' && tabs[index].url().split(/[?#]/, 1)[0] === pages.wechat[1])) {
      tabs[index].url = home;
    }
    chrome.activate();
    return 'ok';
  }
  const window = windows.find(item => item.mode() === 'normal');
  if (!window) return 'no-window';
  window.index = 1;
  window.tabs.push(chrome.Tab({ url: home }));
  window.activeTabIndex = window.tabs().length;
  chrome.activate();
  return 'ok';
}
