const root = document.querySelector('#formatter');
const query = new URLSearchParams(location.search);
const deliveryId = query.get('deliveryId') ?? '';
const parameter = '?deliveryId=' + encodeURIComponent(deliveryId);
const formatAPI = '/api/delivery/wechat';

function element(tag, className = '', ...children) {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children.filter(child => child != null));
  return node;
}

function button(label, action, className = 'format-button') {
  const control = element('button', className, label);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '本机排版服务未能完成操作。');
  return data;
}

function articleDocument(html, preview = false) {
  const style = preview ? ' style="margin:0;padding:12px 0;background:#e9eaf0"' : '';
  return '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1"><title>公众号排版</title></head>' +
    '<body' + style + '>' + html + '</body></html>';
}

function legacyBodyHTML(html, savedTitle) {
  if (!savedTitle) return html;
  const template = document.createElement('template');
  template.innerHTML = html;
  // Older saves recorded the text of the first h1 as the article title.
  const heading = template.content.querySelector('h1');
  if (heading?.textContent.trim().slice(0, 320) !== savedTitle) return html;
  heading.remove();
  return template.content.firstElementChild?.hasChildNodes() ? template.innerHTML : '';
}

async function preview() {
  const { builtInStyles, formatWechat, copyPlainText, copyRichText, downloadBlob } = await import('./排版引擎.mjs');
  const work = await request(formatAPI + parameter);
  const profile = builtInStyles.find(item => item.id === work.layout?.styleId) ?? builtInStyles[0];
  const saved = work.layout?.file ? work.layout : null;
  const result = saved ? await request(formatAPI + '/artifact' + parameter) :
    formatWechat(work.title, work.article, profile.id, work.layout?.theme ?? profile.tokens);
  const title = result.title ?? (saved?.bodyOnly ? saved.title : saved?.title || work.title);
  const html = saved && !saved.bodyOnly ? legacyBodyHTML(result.html, saved.title) : result.html;
  const status = element('p', 'format-status', work.layout ? '已保存排版' : '主题默认排版');
  status.setAttribute('role', 'status');
  const frame = element('iframe', 'format-article-frame');
  frame.title = '排版后的公众号正文';
  frame.setAttribute('sandbox', '');
  frame.referrerPolicy = 'no-referrer';
  frame.srcdoc = articleDocument(html, true);
  const stage = element('div', 'format-preview format-phone', html ? frame : element('p', 'format-state', '暂无正文'));
  const phone = button('手机', () => setDevice(true));
  const desktop = button('桌面', () => setDevice(false));
  function setDevice(isPhone) {
    stage.classList.toggle('format-phone', isPhone);
    phone.setAttribute('aria-pressed', String(isPhone));
    desktop.setAttribute('aria-pressed', String(!isPhone));
  }
  setDevice(true);
  const copyTitle = button('复制标题', async () => {
    const copied = await copyPlainText(title);
    status.textContent = copied ? '标题已复制' : '复制失败，请允许浏览器访问剪贴板后重试';
  });
  copyTitle.disabled = !title;
  const copyBody = button('复制正文图文', async () => {
    const copied = await copyRichText(html).catch(() => null);
    status.textContent = copied?.ok ? '正文图文已复制' : '复制失败，可以下载正文 HTML';
  }, 'format-button format-primary');
  copyBody.disabled = !html;
  const download = button('下载正文 HTML', () => downloadBlob(new Blob([articleDocument(html)],
    { type: 'text/html;charset=utf-8' }), work.entryId + '-公众号正文.html'));
  download.disabled = !html;
  const edit = element('a', 'format-button', '编辑排版');
  edit.href = './公众号排版.html' + parameter + '&view=edit' + (query.get('returnPanel') === 'publish' ? '&returnPanel=publish' : '');
  edit.target = '_blank';
  edit.rel = 'noopener';
  const name = work.layout?.styleName || profile.name;
  const header = element('header', 'format-header',
    element('div', '', element('p', 'format-meta', '定稿 v' + work.version + ' · ' + name), element('h1', '', title || work.title)),
    element('div', 'format-header-actions', element('div', 'format-actions', edit, copyTitle, copyBody, download), status));
  const warning = result.warnings?.find(message => !message.startsWith('尚未在真实公众号后台验收'));
  root.replaceChildren(header, element('div', 'format-preview-toolbar', element('div', 'format-device', phone, desktop),
    warning ? element('p', 'format-status', warning) : null), stage);
}

async function load() {
  try {
    if (query.get('view') === 'preview') await preview();
    else {
      root.replaceChildren(element('p', 'format-state', '正在打开完整公众号排版工作区…'));
      const editor = await request(formatAPI + '/workspace', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deliveryId, returnPanel: query.get('returnPanel') })
      });
      location.replace(editor.url);
    }
  } catch (error) {
    root.replaceChildren(element('p', 'format-state format-error', error.message), button('重新加载', () => location.reload()));
  } finally {
    root.setAttribute('aria-busy', 'false');
  }
}

void load();
