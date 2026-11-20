'use strict';

const catalog = window.WORKBENCH_CATALOG;
const round = window.ROUND;
let local = { checks: [], jobs: [], works: [], ideas: [], deletedIdeas: [], ...(window.WORKBENCH_LOCAL ?? {}), dailyIdeas: window.WORKBENCH_DAILY?.ideas ?? [] };
let live = false;
let timer;
let ideaSource = 'all';
let ideaStatus = 'all';
let visiblePanel;
let revealReviewFor;
let homePlatform = 'douyin';
let homeReadMode = location.protocol === 'http:' && location.hostname === '127.0.0.1' ? 'loading' : 'archive';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const activeMotion = new Set();
const ideaFilters = [['all', '全部'], ['pending', '待建'], ['built', '已建'], ['deleted', '已删除']];
const at = id => document.getElementById(id);
const el = (tag, className = '', ...children) => {
  const item = document.createElement(tag);
  item.className = className;
  item.append(...children.filter(child => child !== null && child !== undefined));
  return item;
};
const link = (label, href, className = '') => {
  if (!href || (/(^\/\/|^[a-z][a-z\d+.-]*:)/i.test(href) && !href.startsWith('https://'))) return null;
  const item = el('a', className, label);
  item.href = href;
  if (href.startsWith('https://')) { item.target = '_blank'; item.rel = 'noopener noreferrer'; }
  return item;
};
const button = (label, className = 'button') => el('button', className, label);
function playMotion(target, frames, timing = {}) {
  if (reducedMotion.matches || !target?.animate) return null;
  const animation = target.animate(frames, { duration: 225, easing: 'cubic-bezier(.22,.75,.24,1)', ...timing });
  activeMotion.add(animation);
  const release = () => activeMotion.delete(animation);
  animation.addEventListener('finish', release, { once: true });
  animation.addEventListener('cancel', release, { once: true });
  return animation;
}

reducedMotion.addEventListener('change', event => {
  if (event.matches) {
    for (const animation of activeMotion) animation.cancel();
    activeMotion.clear();
  }
});

function alignNavMarker() {
  const nav = at('main-nav');
  const selected = nav.querySelector('a[aria-current="page"]');
  const marker = at('nav-marker');
  if (!selected || !nav.offsetWidth) return;
  marker.style.transform = 'translateX(' + selected.offsetLeft + 'px) scaleX(' + selected.offsetWidth / nav.offsetWidth + ')';
  marker.hidden = false;
}

function swapPanel(detail, key, ...nodes) {
  detail.replaceChildren(...nodes);
  if (visiblePanel !== key) {
    playMotion(nodes.at(-1), [{ opacity: .35, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 270 });
    visiblePanel = key;
  }
}
const formatNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 });
const dayTime = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short' });
const dayOnly = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' });
const firstMetric = (record, key) => record?.metrics?.[key];
const display = value => value == null ? '—' : typeof value === 'number' ? formatNumber.format(value) : String(value);
const dateLabel = value => !value ? '未记录' : value.length === 10 ? value : Number.isNaN(Date.parse(value)) ? '未记录' : dayTime.format(new Date(value));
const recordTime = item => item.capturedAt ? dateLabel(item.capturedAt) : item.receivedOn ? item.receivedOn + ' 收到' : '观察时间未记';
const recordBasis = record => record.source?.startsWith('https://') ? record.sourceLabel || '官方后台' : record.sourceLabel || '核验记录';
const publishedStates = { published: '已发布', draft: '后台见草稿', scheduled: '后台见排期', not_visible: '本次未找到', unavailable: '未能核验' };
const stageLabels = [
  ['topic', '定选题', '选清一个读者问题、一件亲历的事。'],
  ['listening', '听你讲', '留住原话、尝试、结果和例外。'],
  ['factcheck', '核对事实', '核材料和可公开范围；需要时找原始出处或反例。'],
  ['draft', '审初稿', '事实和判断由你核实。'],
  ['final', '改口吻、定稿', '写回原话和细节；事实或观点变了就回审。'],
  ['delivery', '双平台交付', '同一版确认正文，分开验收，手动发布。'],
  ['review', '复盘，回到选题', '按相近体裁、页数和 24／72／168 小时窗口对照。']
];

function field(label, name, type = 'text', constraints = {}) {
  const input = el(type === 'textarea' ? 'textarea' : 'input');
  if (type !== 'textarea') input.type = type;
  input.name = name;
  Object.assign(input, constraints);
  return el('label', '', label, input);
}

function statusFor(entry, platform) {
  const observed = [...entry.history[platform], ...local.checks.filter(item => item.entryId === entry.id && item.platform === platform)].reverse();
  observed.sort((left, right) => {
    const observedTime = item => Date.parse(item.capturedAt ?? item.receivedOn ?? '') || 0;
    return observedTime(right) - observedTime(left);
  });
  const publication = observed.find(item => item.state === 'published');
  const snapshot = observed.find(item => item.state === 'published' && Object.keys(item.metrics ?? {}).length);
  const recent = observed[0];
  const state = publication ? 'published' : recent?.state;
  return { observed, publication, snapshot, recent, state, label: publishedStates[state] ?? '待核验' };
}

function currentEntry() {
  const topic = round.topic;
  return {
    id: topic.id, title: topic.title, active: true, topic, group: 'AI 工作手记', localStatus: topic.status, date: round.updatedOn,
    versions: topic.approvedVersion && topic.approvedFile ? [{ id: topic.approvedVersion, label: '已确认正文', text: topic.approvedFile }] : [],
    history: Object.fromEntries(Object.keys(catalog.platforms).map(key => {
      const publication = topic.channels[key]?.publication;
      return [key, publication?.at && publication.evidence ? [{ state: 'published', title: topic.title, publishedAt: publication.at, source: publication.evidence, sourceLabel: '选题卡发布记录', metrics: {} }] : []];
    }))
  };
}

let entries;
let current;
const pathFor = (entry, panel) => '#' + entry.id + '/' + panel;
const allIdeas = () => [...local.ideas, ...local.dailyIdeas].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
function buildEntries() {
  const ideas = new Map(allIdeas().map(idea => [idea.id, idea]));
  const works = local.works.slice().reverse().map(work => ({
    ...work, active: true, localStatus: '待定选题', group: '来自灵感池', date: dayOnly.format(new Date(work.createdAt)),
    versions: [], history: Object.fromEntries(Object.keys(catalog.platforms).map(key => [key, []])),
    idea: ideas.get(work.ideaId), topic: {
      stage: 'topic', records: {}, channels: {},
      nextOwner: '定下这篇要回答的问题，再补一件亲历的事',
      question: work.angle || '谁会需要这篇？读者看完能用上哪一步？',
      resume: '继续作品 ' + work.id + '《' + work.title + '》。先从作品台核对原灵感、写作角度和已有版本；不从头讨论，不推进发布。'
    }
  }));
  return [current, ...works, ...catalog.entries];
}

function route() {
  const hash = location.hash.slice(1);
  if (!hash || hash === 'home') return { home: true };
  if (hash === 'ideas') return { ideas: true };
  if (hash === 'monitor' || hash === 'signals') return { monitor: true };
  const [identifier, section] = hash.split('/');
  const entry = entries.find(item => item.id === identifier) ?? current;
  const panel = ['drafts', 'publish', ...(entry.active ? ['production'] : [])].includes(section) ? section : entry.active ? 'production' : 'drafts';
  return { entry, panel };
}

function library() {
  const chosen = route().entry?.id;
  const query = at('query').value.trim().toLocaleLowerCase();
  const filter = at('filter').value;
  const list = at('library-list');
  const scroll = list.scrollTop;
  const matches = entries.filter(entry => {
    if (query && ![entry.title, entry.originalTitle, entry.id].some(value => value?.toLocaleLowerCase().includes(query))) return false;
    if (filter === 'active') return entry.active;
    if (filter === 'archive') return !entry.active;
    if (filter === 'published') return Object.keys(catalog.platforms).some(key => statusFor(entry, key).publication);
    if (filter === 'unverified') return Object.keys(catalog.platforms).some(key => !statusFor(entry, key).publication);
    return true;
  });
  list.replaceChildren(...matches.map(entry => {
    const releases = Object.keys(catalog.platforms).filter(key => statusFor(entry, key).publication).map(key => catalog.platforms[key].name).join('、');
    const metadata = el('span', 'work-label', el('span', '', entry.active ? entry.localStatus : releases ? releases + '已发' : '历史归档'), el('span', 'number', entry.date ?? entry.id.toUpperCase()));
    const select = link(entry.title, pathFor(entry, entry.active ? 'production' : 'drafts'), 'work-link');
    select.dataset.entry = entry.id;
    select.replaceChildren(el('strong', '', entry.title), metadata);
    if (entry.id === chosen) select.setAttribute('aria-current', 'page');
    select.addEventListener('click', () => { if (matchMedia('(max-width: 750px)').matches) at('library-panel').open = false; });
    return el('li', '', select);
  }));
  list.scrollTop = scroll;
  at('library-total').textContent = matches.length === entries.length ? entries.length + ' 篇' : matches.length + '／' + entries.length;
  at('filter-result').textContent = '找到 ' + matches.length + ' 篇作品';
  at('library-empty').hidden = matches.length !== 0;
}

function head(title, side) {
  return el('div', 'section-head', el('h2', '', title), side ? el('span', '', side) : null);
}

async function api(path, payload) {
  const response = await fetch('/api/' + path, payload === undefined ? { cache: 'no-store' } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? '本机服务未能完成这个操作。');
  return data;
}

function handleForm(form, status, action) {
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    status.classList.remove('error');
    status.textContent = '正在提交…';
    try {
      await action(Object.fromEntries(new FormData(form)));
    } catch (error) {
      status.classList.add('error');
      status.textContent = error.message;
      submit.disabled = false;
    }
  });
}

function jobHistory(entry) {
  const jobs = local.jobs.filter(job => job.entryId === entry.id).reverse();
  if (!jobs.length) return null;
  return el('div', 'job', ...jobs.map(job => {
    const label = job.status === 'done' ? '提纲 v' + job.version + ' · 待审' : job.status === 'running' ? 'Codex 正在整理' : '未取得稿件';
    return el('article', '', el('h3', job.status === 'failed' ? 'error' : '', label),
      el('p', 'hint number', dateLabel(job.finishedAt ?? job.startedAt)),
      job.output ? el('p', 'draft-text', job.output) : job.error ? el('p', 'status', job.error) : el('p', 'status', '完成或失败后会在这里显示。'));
  }));
}

function launchHint() {
  return el('p', 'hint', '当前是只读档案。运行 node workbench/本机服务.mjs 并打开本机地址，即可新增或修改。');
}

function refineWork(entry) {
  if (!entry.ideaId) return null;
  const original = entry.idea;
  const source = el('section', 'source-idea', head('原灵感'), original ? el('p', '', original.title) : null,
    original?.note ? el('p', 'hint idea-note', original.note) : null, link('返回灵感池', '#ideas'));
  if (live) {
    const control = button('保存选题');
    control.type = 'submit';
    const status = el('p', 'status');
    status.setAttribute('role', 'status');
    const form = el('form', 'form',
      field('工作标题', 'title', 'text', { value: entry.title, maxLength: 88, required: true }),
      field('这篇的切入角度', 'angle', 'textarea', { value: entry.angle, maxLength: 1600 }),
      el('div', 'controls', control), status);
    handleForm(form, status, async values => {
      local = await api('works/refine', { ...values, entryId: entry.id });
      render();
      const heading = document.querySelector('.hero h1');
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    });
    source.append(el('details', 'record-toggle', el('summary', '', '调整标题与切入角度'), form));
  }
  return source;
}

function production(entry, review) {
  const topic = entry.topic;
  const queue = el('ol', 'stages');
  for (const [index, [key, label, note]] of stageLabels.entries()) {
    const record = topic.records[key];
    const step = el('li', '', el('span', '', String(index + 1).padStart(2, '0')),
      el('div', '', el('h3', '', label + (key === topic.stage ? ' · 当前' : '')), el('p', '', note), record ? link(record.label, record.file) ?? el('p', '', record.label) : null));
    if (key === topic.stage) step.setAttribute('aria-current', 'step');
    queue.append(step);
  }
  const brief = el('div', 'brief', head('下一步'), el('p', 'owner', topic.nextOwner), el('p', 'question', topic.question), refineWork(entry));
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  const jobs = local.jobs.filter(job => job.entryId === entry.id);
  const latest = jobs.filter(job => job.status === 'done').at(-1);
  const reviewContext = review.hypothesis ? review.text : '';
  if (live) {
    const busy = local.jobs.some(job => job.status === 'running');
    const submit = button(latest ? '提交修改意见' : '交给 Codex 整理提纲', 'button primary');
    submit.type = 'submit';
    submit.disabled = busy;
    const lastMaterials = jobs.at(-1)?.materials ?? '';
    const input = latest ? field('本次怎么改', 'instructions', 'textarea', { required: true, maxLength: 2000 }) :
      field('访谈原话或已确认素材', 'materials', 'textarea', { required: true, maxLength: 12000, value: lastMaterials });
    const instruction = latest ? null : field('本次指令（选填）', 'instructions', 'text', { maxLength: 2000, placeholder: '例：重点留住我最后核验的那一步' });
    const reviewPanel = reviewContext ? el('details', 'record-toggle draft-review',
      el('summary', '', '随创作提交的复盘建议'), el('pre', '', reviewContext)) : null;
    if (revealReviewFor === entry.id) {
      if (reviewPanel) reviewPanel.open = true;
      revealReviewFor = null;
    }
    const form = el('form', 'form', input, instruction, reviewPanel, el('div', 'controls', submit),
      el('p', 'form-note', '本机 Codex 会整理成待审提纲。'), status);
    brief.append(form);
    handleForm(form, status, async values => {
      local = await api('drafts', { ...values, entryId: entry.id, revisionOf: latest?.id, reviewContext });
      render();
      poll();
    });
  } else {
    brief.append(launchHint());
  }
  const resumeText = [topic.resume, reviewContext ?
    '进入创作阶段时，以作者确认的素材和本次指令为准。只在平台、体裁和修改范围适用时采用复盘建议，落实到相应的标题、首图或提纲。这是待验证的试验，历史读数只作编辑参考。\n' + reviewContext : '']
    .filter(Boolean).join('\n\n');
  const resume = el('details', 'resume', el('summary', '', '在 Codex 聊天里接着做'), el('pre', '', resumeText));
  const copy = button('复制接续指令');
  copy.type = 'button';
  const copyStatus = el('p', 'status');
  copyStatus.setAttribute('role', 'status');
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(resumeText);
      copyStatus.textContent = '指令已复制。';
    } catch {
      const selected = document.createRange();
      selected.selectNodeContents(resume.querySelector('pre'));
      getSelection().removeAllRanges();
      getSelection().addRange(selected);
      copyStatus.textContent = '已选中指令，请手动复制。';
    }
  });
  resume.append(copy, copyStatus);
  if (!entry.ideaId) resume.append(el('p', 'hint', '阶段和确认版本仍记在', link('选题卡', './round-state.js'), '里。'));
  brief.append(resume);
  return el('div', '', el('div', 'split', brief, el('section', '', head('制作流程'), queue)), jobHistory(entry));
}

function drafts(entry) {
  const preview = el('div', 'preview');
  const list = el('ul', 'version-list');
  for (const version of entry.versions) {
    const controls = el('div', 'controls');
    if (version.html) {
      const view = button('预览排版');
      view.type = 'button';
      view.setAttribute('aria-expanded', 'false');
      view.addEventListener('click', () => {
        const expanded = view.getAttribute('aria-expanded') === 'true';
        for (const control of list.querySelectorAll('button')) control.setAttribute('aria-expanded', 'false');
        preview.replaceChildren();
        if (!expanded) {
          const frame = el('iframe');
          frame.src = version.html;
          frame.title = entry.title + ' · ' + version.label;
          frame.referrerPolicy = 'no-referrer';
          frame.setAttribute('sandbox', '');
          view.setAttribute('aria-expanded', 'true');
          preview.append(head(version.label), frame);
        }
      });
      controls.append(view, link('打开 HTML', version.html, 'button'));
    }
    if (version.text) controls.append(link('打开正文', version.text, 'button'));
    list.append(el('li', '', el('div', '', el('h3', '', version.label), el('p', 'hint', version.date ?? '选题卡确认版本')), controls));
  }
  const sourceLinks = el('p', 'source-line', link('原作与出处', entry.originalFile), link('标题修订 v4', entry.titleSource), link('完整历史清单', entry.source));
  const jobs = jobHistory(entry);
  const outlineCount = local.jobs.filter(job => job.entryId === entry.id && job.status === 'done').length;
  const saved = entry.versions.length + outlineCount;
  return el('section', '', head('稿件版本', saved + ' 个本地版本'), entry.versions.length ? list : !jobs ? el('p', 'empty', '还没有已存的稿件。') : null, sourceLinks, preview, jobs);
}

function observationForm(entry, key) {
  if (!live) return launchHint();
  const drawer = el('details', 'record-toggle');
  drawer.append(el('summary', '', '记一笔后台核验'));
  const select = el('select');
  select.name = 'state';
  Object.entries(publishedStates).forEach(([value, title]) => {
    const option = el('option', '', value === 'published' ? '后台明确显示已发布' : title);
    option.value = value;
    select.append(option);
  });
  select.value = 'not_visible';
  const title = field('后台原题', 'title', 'text', { maxLength: 320 });
  const date = field('平台发布时间（北京时间）', 'publishedAt', 'datetime-local');
  const identifier = field('作品 ID（可见时）', 'contentId', 'text', { maxLength: 96 });
  const capture = field('查看时间（北京时间，留空记现在）', 'capturedAt', 'datetime-local');
  const metric = catalog.platforms[key].primary;
  const counts = el('div', 'form-grid',
    field(key === 'douyin' ? '播放量' : '阅读量', metric, 'number', { min: '0', step: '1' }),
    field('收藏', 'saves', 'number', { min: '0', step: '1' }),
    field('点赞', 'likes', 'number', { min: '0', step: '1' }),
    field('评论', 'comments', 'number', { min: '0', step: '1' }),
    field('分享', 'shares', 'number', { min: '0', step: '1' }),
    key === 'douyin' ? field('平均浏览图片数', 'averageImages', 'number', { min: '0', step: '0.01' }) : null);
  const identified = el('div', 'form-grid', title, date, identifier);
  const control = button('保存核验记录', 'button primary');
  control.type = 'submit';
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  const form = el('form', 'form', el('label', '', '后台看到的状态', select), identified, capture, counts,
    field('截图说明或核验备注（选填）', 'note', 'textarea', { maxLength: 500 }),
    el('p', 'hint', '只填本账号这篇作品的可见字段；没显示的数字留空。没找到不等于没发布。'),
    el('div', 'controls', control), status);
  const adapt = () => {
    const needsTitle = ['published', 'draft', 'scheduled'].includes(select.value);
    identified.hidden = !needsTitle;
    title.querySelector('input').required = needsTitle;
    date.querySelector('input').required = select.value === 'published';
    counts.hidden = select.value !== 'published';
  };
  select.addEventListener('change', adapt);
  adapt();
  drawer.append(form);
  handleForm(form, status, async values => {
    local = await api('checks', { ...values, entryId: entry.id, platform: key });
    render();
    const marker = at('saved-' + key);
    marker.textContent = '已保存一笔后台核验。';
    marker.focus();
  });
  return drawer;
}

function badge(record) {
  const tag = el('span', 'badge', record.label);
  tag.dataset.state = record.state ?? 'unknown';
  return tag;
}

function publicationPanel(entry, key) {
  const platform = catalog.platforms[key];
  const state = statusFor(entry, key);
  const metrics = el('dl', 'metrics');
  for (const [metric, title] of [[platform.primary, key === 'douyin' ? '播放' : '阅读'], ['saves', '收藏'], ['likes', '点赞'], ['comments', '评论'], ['shares', '分享'], ['averageImages', '平均看图']]) {
    if (key === 'wechat' && metric === 'averageImages') continue;
    metrics.append(el('div', '', el('dt', '', title), el('dd', '', display(firstMetric(state.snapshot, metric)))));
  }
  const channelPackage = entry.topic?.channels[key]?.packageFile;
  const basis = state.publication ? '后台原题：' + state.publication.title + ' · 发布 ' + dateLabel(state.publication.publishedAt) : key === 'wechat' && entry.versions.length ? '已有本地稿件，尚无公众号发布证据。' : '尚无可以确认发布的后台记录。';
  const confirmation = el('p', 'status');
  confirmation.id = 'saved-' + key;
  confirmation.tabIndex = -1;
  confirmation.setAttribute('role', 'status');
  const readLabel = state.snapshot ? el('p', 'hint', '数据：' + recordTime(state.snapshot) + ' · ' + (state.snapshot.window ?? '窗口未标'), ' ', link(recordBasis(state.snapshot), state.snapshot.source)) : null;
  const rows = state.observed.map(record => el('li', '',
    el('strong', '', (publishedStates[record.state] ?? '已记录') + ' · ' + recordTime(record)),
    el('span', 'hint', record.title ? record.title + ' ' : '', record.contentId ? 'ID ' + record.contentId + ' ' : '',
      record.note ? record.note + ' ' : '', link(recordBasis(record), record.source)),
    Object.keys(record.metrics ?? {}).length ? el('span', 'hint number', [`读数 ${display(firstMetric(record, platform.primary))}`, `收藏 ${display(firstMetric(record, 'saves'))}`, record.images != null ? record.images + ' 张图' : null].filter(Boolean).join(' · ')) : null));
  const details = el('details', 'record-toggle observations', el('summary', '', '核验记录（' + rows.length + '）'), rows.length ? el('ul', 'attempts', ...rows) : el('p', 'hint', '没有此篇的后台快照。'));
  return el('section', 'channel', el('div', 'section-head', el('h2', '', platform.name, badge(state)), link('去后台查看', platform.url, 'button')),
    el('p', 'hint', basis), state.recent && state.recent !== state.publication ? el('p', 'hint', '最近核验：' + publishedStates[state.recent.state] + ' · ' + recordTime(state.recent)) : null,
    link('打开本地交付', channelPackage), metrics, readLabel, details, observationForm(entry, key), confirmation);
}

function monitoredRows(items) {
  return items.flatMap(entry => Object.keys(catalog.platforms).map(key => ({ entry, key, state: statusFor(entry, key) })))
    .filter(row => row.state.recent);
}

const measuredCount = rows => new Set(rows.filter(row => row.state.snapshot).map(row => row.entry.id)).size;

function updateNavCounts(items, records) {
  const removed = new Set(local.deletedIdeas.map(item => item.ideaId));
  const badges = [
    ['nav-home', '首页', measuredCount(records), '篇有作品读数'],
    ['nav-ideas', '灵感池', allIdeas().filter(idea => !removed.has(idea.id)).length, '条未删除灵感'],
    ['nav-works', '作品台', items.length, '篇目录作品'],
    ['nav-monitor', '发布监测', records.length, '条作品渠道记录']
  ];
  for (const [id, title, value, unit] of badges) {
    const tab = at(id);
    const description = title + '，' + value + ' ' + unit;
    tab.querySelector('.tab-count').textContent = value;
    tab.setAttribute('aria-label', description);
    tab.title = description;
  }
  alignNavMarker();
  return badges;
}

function monitor(records) {
  const platforms = Object.entries(catalog.platforms).map(([key, platform]) => {
    const count = records.filter(row => row.key === key && row.state.publication).length;
    const attempt = catalog.attempts?.find(item => item.platform === key);
    return el('section', '', el('h2', '', platform.name), el('p', 'hint', '目录内 ' + count + ' 篇有发布证据。', attempt ? ' 最近浏览器核验：' + attempt.detail : ''),
      el('div', 'controls', link('打开官方后台', platform.url, 'button')));
  });
  const table = el('table');
  table.setAttribute('aria-label', '作品最近核验与可见读数');
  const headings = ['作品', '平台', '发布状态', '可见读数', '观察时间'];
  table.append(el('thead', '', el('tr', '', ...headings.map(label => { const item = el('th', '', label); item.scope = 'col'; return item; }))));
  const recent = records.slice()
    .sort((left, right) => (right.state.recent.capturedAt ?? right.state.recent.receivedOn ?? right.state.publication?.publishedAt ?? '').localeCompare(left.state.recent.capturedAt ?? left.state.recent.receivedOn ?? left.state.publication?.publishedAt ?? ''));
  table.append(el('tbody', '', ...recent.map(({ entry, key, state }) => {
    const label = el('th', '', link(entry.title, pathFor(entry, 'publish')));
    label.scope = 'row';
    return el('tr', '', label, el('td', '', catalog.platforms[key].name), el('td', '', badge(state)),
    el('td', 'number', state.snapshot ? (key === 'douyin' ? '播放 ' : '阅读 ') + display(firstMetric(state.snapshot, catalog.platforms[key].primary)) : '—'),
      el('td', 'number', recordTime(state.snapshot ?? state.recent)));
  })));
  const viewport = el('div', 'scroll-table', table);
  viewport.tabIndex = 0;
  viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', '监测表，可以横向滚动');
  return el('div', '', el('header', 'monitor-head', el('h1', '', '发布监测'), el('p', 'hint', '按作品读官方后台。下表不是账号总量，也不是实时同步。')),
    el('div', 'monitor-platforms', ...platforms), head('作品记录', records.length + ' 条渠道记录'), viewport,
    el('p', 'source-line', '截图接收日期不等于拍摄日期；未标指标窗口，不拿不同年龄的作品做因果判断。'));
}

const rowTitle = row => row.state.snapshot.title || row.state.publication?.title || row.entry.originalTitle || row.entry.id;
const snapshotWindow = snapshot => typeof snapshot.window !== 'string' || !snapshot.window ? '窗口未标' : snapshot.window === 'platform_visible_cumulative_at_collection' || snapshot.window.includes('累计') ? '采集时累计' : snapshot.window;
const publishedTime = row => Date.parse(row.state.snapshot?.publishedAt ?? row.state.publication?.publishedAt ?? '') || 0;
const measuredRows = records => records.filter(row => row.state.snapshot).sort((left, right) => publishedTime(right) - publishedTime(left));
const readingDepth = snapshot => `${display(snapshot.metrics.averageImages)} / ${display(snapshot.images)}`;

function readings(key, samples) {
  const platform = catalog.platforms[key];
  const douyin = key === 'douyin';
  const headings = ['原题 / 配文开头', douyin ? '播放' : '阅读', ...(douyin ? ['划走率', '平均看图 / 页数'] : []), '收藏 / 分享', ...(douyin ? ['吸粉'] : []), '读数与口径'];
  const table = el('table', 'reading-table', el('thead', '', el('tr', '', ...headings.map(label => {
    const cell = el('th', '', label);
    cell.scope = 'col';
    return cell;
  }))));
  table.setAttribute('aria-label', platform.name + '作品级读数');
  table.append(el('tbody', '', ...samples.slice(0, 5).map(row => {
    const snapshot = row.state.snapshot;
    const metrics = snapshot.metrics;
    const title = el('th', '', link(rowTitle(row), pathFor(row.entry, 'publish')));
    title.scope = 'row';
    const swipe = typeof metrics.swipeRate === 'number' ? display(metrics.swipeRate) + '%' : display(metrics.swipeRate);
    const cell = value => el('td', 'number', value);
    return el('tr', '', title, cell(display(metrics[platform.primary])),
      ...(douyin ? [cell(swipe), cell(readingDepth(snapshot))] : []),
      cell(display(metrics.saves) + ' / ' + display(metrics.shares)), ...(douyin ? [cell(display(metrics.follows))] : []),
      el('td', '', link(recordTime(snapshot), snapshot.source ?? pathFor(row.entry, 'publish')), el('span', 'reading-window', snapshotWindow(snapshot))));
  })));
  const area = el('div', 'scroll-table', table);
  area.tabIndex = 0;
  area.setAttribute('role', 'region');
  area.setAttribute('aria-label', platform.name + '读数表，可横向滚动');
  return area;
}

function reviewSuggestion(rows) {
  const focus = rows.some(row => row.key === 'douyin') ? rows.filter(row => row.key === 'douyin') : rows;
  const samples = focus.slice(0, 2).map(row => {
    const snapshot = row.state.snapshot;
    const metrics = snapshot.metrics;
    const primary = row.key === 'douyin' ? '播放' : '阅读';
    const depth = row.key === 'douyin' && metrics.averageImages != null ? '，平均看图 ' + readingDepth(snapshot) : '';
    return row.entry.id + '「' + rowTitle(row) + '」：' + primary + ' ' + display(metrics[catalog.platforms[row.key].primary]) +
      '，收藏 ' + display(metrics.saves) + depth + '（' + recordTime(snapshot) + '，' + snapshotWindow(snapshot) + '）。';
  });
  const edit = !focus.length ? '先补一批可追溯的作品读数，再决定改哪里。' :
    focus[0].key === 'douyin' ? '只改首图标题：把抽象判断改成一个具体的工作问题。保持后续图文、页数不变。' :
    '只改文章标题的切入角度，正文与配图不变。';
  const check = '在发布后 24、72、168 小时留同口径读数；同平台、体裁和页数再比较。' +
    (focus[0]?.key === 'douyin' ? '先看划走率和平均看图，再看收藏、分享。' : '记录平台可见的阅读、收藏和分享。');
  const hypothesis = !focus.length ? '' : focus[0].key === 'douyin' ? '待验证：更具体的首图问题可能减少划走。' : '待验证：更具体的标题切入点可能带来更多阅读。';
  const boundary = '这是作品快照，不是实时数据。未对齐发布年龄或指标窗口，不据此下因果结论。';
  const text = ['飞轮复盘｜给下一篇的试验提案，不是已经证实的规则。', ...samples, boundary, '下一篇：' + edit, hypothesis, '复测：' + check].filter(Boolean).join('\n');
  const latestDouyin = focus[0]?.key === 'douyin' ? focus[0].state.snapshot : null;
  return { edit, hypothesis, text, latestDouyin };
}

function nextExperiment({ edit, hypothesis, text, latestDouyin }) {
  const copy = button('复制上下文');
  copy.type = 'button';
  const feedback = el('p', 'status');
  feedback.setAttribute('role', 'status');
  const context = el('pre', 'analysis-context', text);
  const full = el('details', 'record-toggle home-evidence', el('summary', '', '展开依据与测试口径'), context);
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(text); feedback.textContent = '上下文已复制。'; }
    catch {
      full.open = true;
      const range = document.createRange();
      range.selectNodeContents(context);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      feedback.textContent = '已选中，按复制快捷键即可。';
    }
  });
  const apply = live ? button('带到作品台', 'button primary') : null;
  if (apply) {
    apply.type = 'button';
    apply.addEventListener('click', () => {
      const selected = entries.find(entry => entry.active && pathFor(entry, 'production') === at('nav-works').getAttribute('href')) ?? current;
      revealReviewFor = selected.id;
      location.hash = pathFor(selected, 'production');
    });
  }
  const sentence = edit.indexOf('。');
  const lead = sentence === -1 ? edit : edit.slice(0, sentence + 1);
  const rest = sentence === -1 ? '' : edit.slice(sentence + 1);
  const evidenceBrief = latestDouyin?.metrics.averageImages != null ?
    '最近一篇平均看图 ' + readingDepth(latestDouyin) + '，' + snapshotWindow(latestDouyin) + '。' : '';
  return el('aside', 'home-card analysis-next', el('div', 'home-card-head', el('h2', '', '今日行动'),
    el('span', 'home-tag', hypothesis ? '待验证' : '待补数据')),
    el('div', 'home-action-body', el('h3', '', lead), rest ? el('p', '', rest) : null,
      hypothesis ? el('p', '', evidenceBrief + hypothesis.replace(/^待验证：/, '')) : null,
      el('div', 'controls', apply, copy), feedback, full));
}

const homeGlyphs = {
  readings: 'M3 12h4l3-5 3 9 3-6h5',
  ideas: 'M9 17h6m-5 4h4M8 14a6 6 0 1 1 8 0c-1 .8-1 1.2-1 3H9c0-1.8 0-2.2-1-3Z',
  works: 'M7 3h7l4 4v14H7zm7 0v5h4M10 12h5m-5 4h5',
  monitor: 'M4 5h16v11H4zm4 15h8m-4-4v4m-4-8 2-2 2 2 3-3',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M7 17 17 7M9 7h8v8',
  profile: 'M4 5h16v14H4zm3 11 4-4 3 2 3-4'
};

function homeIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS(svg.namespaceURI, 'path');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'home-icon');
  path.setAttribute('d', homeGlyphs[name]);
  svg.append(path);
  return svg;
}

function homeCover(row) {
  const frame = el('span', 'home-cover', homeIcon('works'));
  frame.setAttribute('aria-hidden', 'true');
  const source = row.entry.cover;
  if (!source) {
    frame.title = '暂无作品封面';
    return frame;
  }
  const image = el('img');
  image.alt = '';
  image.decoding = 'async';
  image.addEventListener('error', () => { image.remove(); frame.title = '封面未能读取'; }, { once: true });
  image.src = source;
  frame.title = '作品封面';
  frame.append(image);
  return frame;
}

function homeStatus(mode) {
  homeReadMode = mode;
  const label = at('home-data-status');
  if (label) {
    label.dataset.mode = mode;
    const text = { loading: '正在读取本机记录', ready: '本机作品快照', archive: '离线作品档案', error: '未能刷新 · 保留已有记录' }[mode];
    if (label.textContent !== text) label.textContent = text;
  }
}

function homeKpis(badges, raw) {
  const values = new Map(badges.map(([id, , value]) => [id, value]));
  const cards = [
    ['nav-home', '有读数的作品', '跨渠道按作品去重', 'readings'],
    ['nav-ideas', '在池灵感', '未删除，含已建作品', 'ideas', '#ideas'],
    ['nav-works', '作品总数', '含在制与历史归档', 'works', at('nav-works').getAttribute('href')],
    ['nav-monitor', '发布监测记录', '按作品与渠道计数', 'monitor', '#monitor']
  ];
  const panel = el('section', 'home-kpis');
  panel.setAttribute('aria-label', '核心运营指标');
  for (const [id, label, note, icon, target] of cards) {
    const card = target ? link('', target, 'home-kpi') : button('', 'home-kpi');
    if (!target) {
      card.type = 'button';
      card.addEventListener('click', () => {
        raw.open = true;
        raw.querySelector('summary').focus({ preventScroll: true });
        raw.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
      });
    }
    card.setAttribute('aria-label', label + '：' + display(values.get(id)) + '。' + note + '，' + (target ? '打开对应页面' : '查看详细读数'));
    card.append(el('div', 'home-kpi-label', homeIcon(icon), label, homeIcon('arrow')),
      el('strong', 'home-kpi-value number', display(values.get(id))), el('span', 'home-kpi-note', note));
    panel.append(card);
  }
  return panel;
}

function homeEmpty(title, detail) {
  return el('div', 'home-empty', homeIcon('profile'), el('div', '', el('strong', '', title), el('p', '', detail)));
}

function homeBars({ key, platform, samples }) {
  const rows = samples.slice(0, 5);
  if (!rows.length) return homeEmpty('暂无作品读数', '没有记录不等于没发布。核验入口仍在发布监测。');
  const max = Math.max(1, ...rows.map(row => firstMetric(row.state.snapshot, platform.primary)).filter(Number.isFinite));
  const list = el('ul', 'home-bars', ...rows.map(row => {
    const value = firstMetric(row.state.snapshot, platform.primary);
    const track = el('span', 'home-bar-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = el('span', 'home-bar-fill');
    fill.style.transform = 'scaleX(' + (Number.isFinite(value) ? value / max : 0) + ')';
    track.append(fill);
    const title = link(rowTitle(row), pathFor(row.entry, 'publish'), 'home-bar-title');
    title.title = rowTitle(row);
    return el('li', '', el('div', 'home-bar-label', title, el('strong', 'number', display(value))), track);
  }));
  list.setAttribute('aria-label', platform.name + (key === 'douyin' ? '可见播放量' : '可见阅读量'));
  return list;
}

function homeRecent({ key, platform, samples }) {
  if (!samples.length) return homeEmpty('暂无可展示的近期表现', '记录读数后，作品和指标会出现在这里。');
  const metric = (label, value) => el('div', '', el('dt', '', label), el('dd', 'number', value));
  return el('ul', 'home-works', ...samples.slice(0, 5).map(row => {
    const snapshot = row.state.snapshot;
    const title = rowTitle(row);
    const date = publishedTime(row) ? '发布 ' + dateLabel(snapshot.publishedAt ?? row.state.publication?.publishedAt) : recordTime(snapshot);
    const entry = link('', pathFor(row.entry, 'publish'), 'home-work');
    entry.setAttribute('aria-label', '查看发布数据：' + title);
    const name = el('strong', 'home-work-title', title);
    name.title = title;
    entry.append(homeCover(row),
      el('div', 'home-work-copy', name, el('div', 'home-work-meta', el('span', 'home-tag', platform.name), el('span', '', date))),
      el('dl', 'home-work-metrics',
        metric(key === 'douyin' ? '播放' : '阅读', display(snapshot.metrics[platform.primary])),
        metric('收藏', display(snapshot.metrics.saves)), metric('分享', display(snapshot.metrics.shares)),
        key === 'douyin' ? metric('平均看图 / 页数', readingDepth(snapshot)) : null),
      homeIcon('arrow'));
    return el('li', '', entry);
  }));
}

function analysisHome(records, badges) {
  const measured = measuredRows(records);
  const workIds = new Set(local.works.map(work => work.id));
  const scoped = records.filter(row => workIds.has(row.entry.id));
  const progressed = new Set(scoped.filter(row => row.state.publication).map(row => row.entry.id)).size;
  const phases = [['入池灵感', allIdeas().length], ['已建作品', workIds.size], ['已核实发布', progressed], ['已有读数', measuredCount(scoped)]];
  const flow = el('dl', 'analysis-flow', ...phases.map(([label, value]) => el('div', '', el('dt', '', label), el('dd', 'number', display(value)))));
  const groups = Object.entries(catalog.platforms).map(([key, platform]) => ({ key, platform,
    samples: measured.filter(row => row.key === key),
    published: records.filter(row => row.key === key && row.state.publication).length
  }));
  const coverage = group => group.published ? group.samples.length + ' / ' + group.published + ' 篇已核发布作品有读数' : '暂无可确认的发布证据';
  const references = el('details', 'record-toggle analysis-references', el('summary', '', '指标参考'),
    el('ul', '', el('li', '', link('Buffer', 'https://support.buffer.com/articles/using-buffer-home-WXHZkDiPYb'), '：同周期比较触达、互动和吸粉，详细指标回到作品。'),
      el('li', '', link('见舟', 'https://github.com/tangchengjiao/jianzhou-media-workbench#readme'), '：按发布后的时间点留快照，回看发布前的判断。'),
      el('li', '', link('DSH Media Desk', 'https://github.com/woniuniuniu/dsh-media-desk#复盘'), '：复盘后提炼下一轮可采用的写作建议。')));
  const raw = el('details', 'home-card home-raw',
    el('summary', '', el('span', '', '详细作品读数'), el('span', 'home-tag', '口径与出处')),
    el('div', 'home-raw-body', el('p', '', '各平台按发布时间展示最近有读数的 5 篇。— 表示缺测，不等于 0。'),
      ...groups.map(group => el('section', 'analysis-platform', head(group.platform.name, coverage(group)),
        group.samples.length ? readings(group.key, group.samples) : el('p', '', '暂无作品级读数。没有记录不等于没发布。'))),
      link('打开全部发布监测记录', '#monitor', 'home-text-link')));
  const status = el('span', 'home-data-status', { loading: '正在读取本机记录', ready: '本机作品快照', archive: '离线作品档案', error: '未能刷新 · 保留已有记录' }[homeReadMode]);
  status.id = 'home-data-status';
  status.dataset.mode = homeReadMode;
  status.setAttribute('role', 'status');
  const observationTime = snapshot => Date.parse(snapshot?.capturedAt ?? snapshot?.receivedOn ?? '') || 0;
  const latest = measured.map(row => row.state.snapshot).sort((left, right) => observationTime(right) - observationTime(left))[0];
  const create = link('新建作品', '#ideas', 'button primary home-create');
  create.prepend(homeIcon('plus'));
  create.setAttribute('aria-label', '新建作品，前往灵感池选题');
  const coverageLabel = el('p', 'home-muted');
  const bars = el('div', 'home-plot');
  const chartNote = el('p', 'home-chart-note');
  const recent = el('div', 'home-recent-body');
  const recentCount = el('span', 'home-muted');
  const switcher = el('div', 'home-platforms');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', '按平台查看内容表现与近期作品');
  for (const { key, platform } of groups) {
    const item = button(platform.name, 'home-platform');
    item.type = 'button';
    item.dataset.platform = key;
    item.addEventListener('click', () => {
      if (homePlatform !== key) { homePlatform = key; showPlatform(); playMotion(bars, [{ opacity: .5 }, { opacity: 1 }], { duration: 175 }); }
    });
    switcher.append(item);
  }
  function showPlatform() {
    const group = groups.find(item => item.key === homePlatform) ?? groups[0];
    for (const item of switcher.children) item.setAttribute('aria-pressed', String(item.dataset.platform === group.key));
    coverageLabel.textContent = coverage(group);
    chartNote.hidden = !group.samples.length;
    chartNote.textContent = (group.key === 'douyin' ? '播放量' : '阅读量') + ' · 按发布时间排列，作品读数窗口可能不同。';
    recentCount.textContent = group.platform.name + ' · ' + Math.min(5, group.samples.length) + ' 篇有读数';
    bars.replaceChildren(homeBars(group));
    recent.replaceChildren(homeRecent(group));
  }
  showPlatform();
  return el('div', 'analysis-home',
    el('header', 'home-heading',
      el('div', '', el('h1', '', '运营概览'), el('p', '', '基于已记录的内容与发布表现')),
      el('div', 'home-heading-actions', el('div', 'home-freshness', status, latest ? el('span', '', '最近读数：' + recordTime(latest)) : null), create)),
    homeKpis(badges, raw),
    el('div', 'analysis-grid',
      el('section', 'home-card home-performance',
        el('div', 'home-card-head', el('div', '', el('h2', '', '内容表现'), coverageLabel), switcher),
        bars, chartNote),
      nextExperiment(reviewSuggestion(measured))),
    el('section', 'home-card home-recent', el('div', 'home-card-head',
      el('div', '', el('h2', '', '近期作品'), recentCount), link('全部记录', '#monitor', 'home-text-link')), recent),
    el('section', 'home-card analysis-path',
      el('div', 'home-card-head', el('h2', '', '灵感转化'), el('p', 'home-muted', '含已删除灵感，不含历史导入稿件')), flow),
    raw, references);
}

function focusIdeaFilter() {
  at('idea-filters')?.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
}

async function markIdeaDeleted(ideaId, deleted) {
  local = await api('ideas/deletion', { ideaId, deleted });
}

function showFeedback(message, { undoId, focus = false } = {}) {
  const notice = at('feedback');
  const content = at('feedback-message');
  const controls = at('feedback-actions');
  notice.hidden = false;
  content.textContent = message;
  const close = button('关闭', 'button ghost');
  close.type = 'button';
  close.addEventListener('click', () => {
    notice.hidden = true;
    if (route().ideas) focusIdeaFilter();
    else at('detail').focus({ preventScroll: true });
  });
  controls.replaceChildren(close);
  if (undoId) {
    const undo = button('撤销');
    undo.type = 'button';
    undo.addEventListener('click', async event => {
      undo.disabled = true;
      try {
        await markIdeaDeleted(undoId, false);
        renderIdeas(true);
        showFeedback('已恢复到灵感池。');
        if (event.detail === 0 && route().ideas) focusIdeaFilter();
      } catch (error) { content.textContent = error.message; undo.disabled = false; }
    });
    controls.prepend(undo);
    if (focus) undo.focus({ preventScroll: true });
  }
  playMotion(notice, [{ opacity: 0, transform: 'translateY(10px) scale(.985)' }, { opacity: 1, transform: 'none' }], { duration: 240 });
}

function renderIdeas(animateRows = false) {
  const items = buildEntries();
  updateNavCounts(items, monitoredRows(items));
  const list = at('idea-list');
  if (!list) return;
  const ideas = allIdeas();
  const today = dayOnly.format(new Date());
  const generatedToday = local.dailyIdeas.filter(idea => idea.day === today).length;
  const converted = new Map(local.works.map(item => [item.ideaId, item]));
  const removed = new Set(local.deletedIdeas.map(item => item.ideaId));
  const bySource = ideas.filter(idea => ideaSource === 'all' || idea.source === ideaSource);
  const visible = bySource.filter(idea => !removed.has(idea.id));
  const buckets = {
    all: visible,
    pending: visible.filter(idea => !converted.has(idea.id)),
    built: visible.filter(idea => converted.has(idea.id)),
    deleted: bySource.filter(idea => removed.has(idea.id))
  };
  const matches = buckets[ideaStatus];
  const filters = at('idea-filters').querySelectorAll('button');
  for (const control of filters) {
    const key = control.dataset.ideaFilter;
    control.setAttribute('aria-pressed', String(key === ideaStatus));
    control.querySelector('.number').textContent = buckets[key].length;
  }
  at('idea-count').textContent = matches.length + ' 条';
  at('idea-daily').textContent = local.dailyError || (generatedToday ? 'Codex 今日生成 ' + generatedToday + ' 条' : '今日尚无 Codex 灵感');
  at('idea-empty').hidden = matches.length !== 0;
  const emptyMessages = { all: '当前筛选下没有灵感。', pending: '没有待建作品的灵感。', built: '还没有建成作品的灵感。', deleted: '没有已删除的灵感。' };
  at('idea-empty').textContent = !ideas.length && ideaStatus === 'all' ? '现在还没有灵感，先记下一件让你想多问一句的事。' : emptyMessages[ideaStatus];
  const layoutKey = JSON.stringify([live, matches.map(idea => [idea.id, converted.get(idea.id)?.id, removed.has(idea.id)])]);
  if (layoutKey === list.dataset.layoutKey) return;
  list.dataset.layoutKey = layoutKey;
  const focused = document.activeElement;
  const focusedId = list.contains(focused) ? focused.closest('[data-idea-id]')?.dataset.ideaId : null;
  const before = animateRows && !reducedMotion.matches ? new Map(Array.from(list.children).slice(0, 8).map(row => [row.dataset.ideaId, row.getBoundingClientRect().top])) : null;
  list.replaceChildren(...matches.map(idea => {
    const work = converted.get(idea.id);
    const deleted = removed.has(idea.id);
    const source = idea.source === 'codex' ? 'Codex' : '我添加的';
    const status = el('p', 'status');
    status.setAttribute('role', 'status');
    let action = work ? link('打开作品', pathFor(work, 'production'), 'button') : null;
    if (action) action.dataset.ideaAction = 'open';
    if (live && !work && !deleted) {
      const create = button('新建作品');
      create.type = 'button';
      create.dataset.ideaAction = 'create';
      create.setAttribute('aria-label', '从「' + idea.title + '」新建作品');
      create.addEventListener('click', async () => {
        create.disabled = true;
        status.textContent = '正在新建…';
        status.classList.remove('error');
        try {
          const { entryId, ...snapshot } = await api('works', { ideaId: idea.id });
          local = snapshot;
          at('query').value = '';
          at('filter').value = 'all';
          location.hash = '#' + entryId + '/production';
        } catch (error) {
          status.classList.add('error');
          status.textContent = error.message;
          create.disabled = false;
        }
      });
      action = create;
    }
    const state = el('span', 'idea-state', work ? '已建作品' : '待建作品');
    state.dataset.built = String(Boolean(work));
    const label = el('p', 'idea-meta', el('span', idea.source === 'codex' ? 'accent' : '', source),
      el('span', 'number', idea.day ?? dayOnly.format(new Date(idea.createdAt))), state);
    const actions = el('div', 'idea-actions', action);
    const card = el('li', 'idea-entry', el('div', 'idea-text', label, el('h3', '', idea.title),
      idea.note ? el('p', 'idea-note', idea.note) : null, status), actions.childElementCount || live ? actions : null);
    card.dataset.ideaId = idea.id;
    if (live) {
      const change = button(deleted ? '恢复' : '删除', deleted ? 'button' : 'button ghost danger');
      change.type = 'button';
      change.dataset.ideaAction = deleted ? 'restore' : 'delete';
      change.setAttribute('aria-label', (deleted ? '恢复灵感：' : '删除灵感：') + idea.title);
      change.addEventListener('click', async event => {
        if (actions.querySelector('button:disabled')) return;
        change.disabled = true;
        const create = actions.querySelector('[data-idea-action="create"]');
        if (create) create.disabled = true;
        status.classList.remove('error');
        status.textContent = deleted ? '正在恢复…' : '正在删除…';
        try {
          await markIdeaDeleted(idea.id, !deleted);
          if (card.isConnected) {
            const motion = playMotion(card, [{ opacity: 1 }, { opacity: .15, transform: 'translateX(5px)' }], { duration: 125, fill: 'forwards' });
            if (motion) await motion.finished.catch(() => {});
          }
          renderIdeas(true);
          const keyboard = event.detail === 0 && route().ideas;
          if (deleted) {
            showFeedback('已恢复到灵感池。');
            if (keyboard) focusIdeaFilter();
          } else {
            showFeedback(work ? '已移到「已删除」，原作品保留。' : '已移到「已删除」。', { undoId: idea.id, focus: keyboard });
          }
        } catch (error) {
          status.classList.add('error');
          status.textContent = error.message;
          change.disabled = false;
          if (create) create.disabled = false;
        }
      });
      actions.append(change);
    }
    return card;
  }));
  if (focusedId) {
    const row = Array.from(list.children).find(item => item.dataset.ideaId === focusedId);
    const replacement = row && Array.from(row.querySelectorAll('[data-idea-action]')).find(item => item.dataset.ideaAction === focused.dataset.ideaAction);
    if (replacement) replacement.focus({ preventScroll: true });
    else focusIdeaFilter();
  }
  if (before) {
    Array.from(list.children).slice(0, 8).forEach((row, index) => {
      const previous = before.get(row.dataset.ideaId);
      if (previous === undefined) {
        playMotion(row, [{ opacity: .25, transform: 'translateY(7px)' }, { opacity: 1, transform: 'none' }],
          { delay: Math.min(index, 3) * 22, fill: 'backwards' });
        return;
      }
      const offset = previous - row.getBoundingClientRect().top;
      if (Math.abs(offset) > 1 && Math.abs(offset) < innerHeight) {
        playMotion(row, [{ transform: 'translateY(' + offset + 'px)' }, { transform: 'none' }], { duration: 260 });
      }
    });
  }
}

function ideaPool() {
  const date = dayOnly.format(new Date());
  const source = el('select');
  source.id = 'idea-source';
  for (const [value, label] of [['all', '全部来源'], ['manual', '我添加的'], ['codex', 'Codex']]) {
    const option = el('option', '', label);
    option.value = value;
    source.append(option);
  }
  source.value = ideaSource;
  source.addEventListener('change', () => { ideaSource = source.value; renderIdeas(true); });
  const label = el('label', 'sr', '按灵感来源筛选');
  label.htmlFor = source.id;
  const count = el('span', 'number');
  count.id = 'idea-count';
  const filters = el('div', 'idea-filters', ...ideaFilters.map(([key, title]) => {
    const control = button(title, 'idea-filter');
    control.type = 'button';
    control.dataset.ideaFilter = key;
    control.append(el('span', 'number'));
    control.addEventListener('click', () => { ideaStatus = key; renderIdeas(true); });
    return control;
  }));
  filters.id = 'idea-filters';
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', '按灵感状态筛选');
  const daily = el('span', 'hint');
  daily.id = 'idea-daily';
  daily.setAttribute('role', 'status');
  const list = el('ul', 'idea-list');
  list.id = 'idea-list';
  const empty = el('p', 'empty');
  empty.id = 'idea-empty';
  const input = el('aside', 'idea-input', head('记灵感'));
  let shortcut;
  if (live) {
    const status = el('p', 'status');
    status.setAttribute('role', 'status');
    const submit = button('添加灵感', 'button primary');
    submit.type = 'submit';
    const form = el('form', 'form',
      field('灵感标题', 'title', 'text', { required: true, maxLength: 88, placeholder: '一句话记下它' }),
      field('场景、疑问或切入点（选填）', 'note', 'textarea', { maxLength: 1600 }),
      el('div', 'controls', submit), status);
    handleForm(form, status, async values => {
      local = await api('ideas', values);
      form.reset();
      submit.disabled = false;
      status.textContent = '已添加到灵感池。';
      ideaSource = 'all';
      ideaStatus = 'all';
      source.value = ideaSource;
      renderIdeas(true);
      form.elements.title.focus();
    });
    input.append(form);
    shortcut = button('记灵感', 'button idea-shortcut');
    shortcut.type = 'button';
    shortcut.addEventListener('click', () => form.elements.title.focus());
  } else input.append(launchHint());
  return el('div', 'idea-board', el('header', 'pool-head',
    el('div', '', el('p', 'identifier', date), el('h1', '', '灵感池')),
    el('div', 'pool-focus', daily, shortcut)),
    el('div', 'idea-grid',
      el('section', '', el('div', 'idea-toolbar', el('h2', '', '候选选题', count), label, source), filters, list, empty),
      input));
}

function render() {
  entries = buildEntries();
  const view = route();
  const wide = Boolean(view.home || view.ideas);
  at('works-library').hidden = wide;
  document.querySelector('.desk').classList.toggle('wide-view', wide);
  if (!wide) library();
  for (const [identifier, selected] of [['nav-home', Boolean(view.home)], ['nav-ideas', Boolean(view.ideas)], ['nav-works', Boolean(view.entry)], ['nav-monitor', Boolean(view.monitor)]]) {
    if (selected) at(identifier).setAttribute('aria-current', 'page');
    else at(identifier).removeAttribute('aria-current');
  }
  at('connection').textContent = live ? '本机服务已启动' : '本地档案';
  at('connection').dataset.live = String(live);
  const detail = at('detail');
  detail.setAttribute('aria-label', view.home ? '运营概览' : view.ideas ? '灵感池' : view.monitor ? '发布监测' : '作品详情');
  if (view.ideas) { swapPanel(detail, 'ideas', ideaPool()); renderIdeas(); return; }
  const records = monitoredRows(entries);
  const badges = updateNavCounts(entries, records);
  if (view.home) { swapPanel(detail, 'home', analysisHome(records, badges)); return; }
  if (view.monitor) { swapPanel(detail, 'monitor', monitor(records)); return; }
  const { entry, panel } = view;
  at('nav-works').href = pathFor(entry, entry.active ? 'production' : 'drafts');
  const nav = el('nav', 'tabs');
  nav.setAttribute('aria-label', '当前作品');
  const tabs = [...(entry.active ? [['production','制作']] : []), ['drafts','稿件与版本'], ['publish','发布与数据']];
  for (const [key, label] of tabs) {
    const tab = link(label, pathFor(entry, key));
    if (panel === key) tab.setAttribute('aria-current', 'page');
    nav.append(tab);
  }
  const sameTitle = entry.originalTitle?.replace(/\s/g, '') === entry.title.replace(/\s/g, '');
  const sub = entry.ideaId ? entry.angle : entry.active ? '从亲历的工作出发，写清 AI 做了什么、人又判断了什么。' :
    sameTitle && !entry.sourcePlatformUnknown ? '' : '原作：' + entry.originalTitle + (entry.sourcePlatformUnknown ? '（原系列标记已发，平台未核）' : '');
  const heading = el('h1', '', entry.title);
  const clauses = entry.title.length > 15 && entry.title.match(/^([^，：。]{5,23}[，：])(.+)$/u);
  if (clauses) heading.replaceChildren(el('span', 'title-clause', clauses[1]), clauses[2]);
  const hero = el('header', 'hero', el('div', 'hero-meta', el('span', 'identifier', entry.id.toUpperCase()), el('span', '', entry.group + ' · ' + entry.localStatus)),
    heading, sub ? el('p', '', sub) : null);
  const content = panel === 'production' ? production(entry, reviewSuggestion(measuredRows(records))) : panel === 'drafts' ? drafts(entry) :
    el('div', '', ...Object.keys(catalog.platforms).map(key => publicationPanel(entry, key)));
  swapPanel(detail, pathFor(entry, panel), hero, nav, content);
}

function poll() {
  clearTimeout(timer);
  if (!live || !local.jobs.some(job => job.status === 'running')) return;
  timer = setTimeout(async () => {
    try {
      const before = local;
      const next = await api('state');
      if (local !== before) { poll(); return; }
      const changed = JSON.stringify(local.jobs.map(job => job.status)) !== JSON.stringify(next.jobs.map(job => job.status));
      local = next;
      if (changed && !route().ideas) render();
      else if (route().ideas) renderIdeas();
      poll();
    } catch {
      at('connection').textContent = '联动暂断 · 重新打开可续查';
    }
  }, 1800);
}

async function refreshOverview() {
  const view = route();
  if (!live || !(view.ideas || view.home)) return;
  if (view.home) homeStatus('loading');
  try {
    const before = local;
    const next = await api('state');
    if (view.home) homeStatus('ready');
    if (local !== before) return;
    local = next;
    if (route().ideas) renderIdeas();
    else if (route().home && JSON.stringify(before) !== JSON.stringify(next)) render();
  } catch {
    if (view.home) homeStatus('error');
    if (at('idea-daily')) at('idea-daily').textContent = '未刷新，仍显示上次读取的灵感。';
  }
}

if (!catalog?.entries || !round?.topic) {
  at('load-error').hidden = false;
} else {
  current = currentEntry();
  at('nav-works').href = pathFor(current, 'production');
  at('query').addEventListener('input', library);
  at('filter').addEventListener('change', library);
  document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); at('detail').focus(); });
  window.addEventListener('hashchange', () => {
    render();
    refreshOverview();
    at('detail').focus({ preventScroll: true });
    if (matchMedia('(max-width: 750px)').matches) at('detail').scrollIntoView({ block: 'start' });
  });
  window.addEventListener('focus', refreshOverview);
  window.addEventListener('resize', alignNavMarker);
  render();
  if (location.protocol === 'http:' && location.hostname === '127.0.0.1') {
    api('state').then(data => {
      if (!Array.isArray(data.ideas) || !Array.isArray(data.works) || !Array.isArray(data.deletedIdeas)) { homeStatus('error'); return; }
      homeStatus('ready');
      live = true; local = data; render(); poll();
    }).catch(() => { homeStatus('error'); });
  }
}
