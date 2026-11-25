'use strict';

const catalog = window.WORKBENCH_CATALOG;
const round = window.ROUND;
const { draftActions, articleLimit, manuscriptProgress, canReturnTo, draftBlocks, draftWordCount, wechatLengthRange,
  douyinTitleLength, douyinTitleLimit } = globalThis.WORKBENCH_DRAFT_EDITING;
let local = { checks: [], jobs: [], works: [], ideas: [], deletedIdeas: [], finals: [], imageJobs: [], platformFiles: {},
  ...(window.WORKBENCH_LOCAL ?? {}), dailyIdeas: window.WORKBENCH_DAILY?.ideas ?? [] };
let live = false;
let timer;
let ideaSource = 'all';
let ideaStatus = 'all';
let visiblePanel;
let revealReviewFor;
let homePlatform = 'douyin';
let checkingPublication;
let checkFeedback;
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
const publishedStates = { published: '已发布', draft: '后台见草稿', scheduled: '后台见排期', not_visible: '本次未找到', unavailable: '未能核验', partial_visible: '待确认' };
const publicationDate = record => record.publishedAt ? dateLabel(record.publishedAt) : record.publishedLabel ? record.publishedLabel + '（后台显示）' : '未记录';
const stageLabels = [
  ['topic', '定选题'], ['listening', '听你讲'], ['draft', '审稿'], ['final', '定稿'],
  ['delivery', '平台交付'], ['verify', '发布核验'], ['review', '数据复盘']
];
const draftLabels = { draft: '初稿', revise: '修改稿', polish: '口吻稿', manual: '手动编辑稿' };
const manuscriptTitle = job => job.passage ? '局部修改稿' : draftLabels[job.action] ?? '旧提纲';
const workStatusLabels = { topic: '待定选题', listening: '待写初稿', draft: '待审稿', final: '待定稿',
  delivery: '平台交付中', verify: '待核实发布', review: '已发布 · 数据复盘' };

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

function workProgress(entry) {
  const work = manuscriptProgress(local, entry.topic);
  const { delivery, published } = work;
  const files = delivery && local.platformFiles?.[delivery.id];
  const prepared = Boolean(files?.article && files?.copy && files.images.length && files.images.every(Boolean) &&
    files.wechatCovers?.length === 2 && files.wechatCovers.every(wechatCoverReady));
  const channels = Object.keys(catalog.platforms).map(key => [key, statusFor(entry, key)]);
  return { ...work, files, channels, prepared, stage: published ? 'review' : prepared ? 'verify' : work.stage };
}

function currentEntry() {
  const topic = { ...round.topic, ...local.roundTopic };
  return {
    id: topic.id, title: topic.title, angle: topic.angle, active: true, topic, group: 'AI 工作手记', localStatus: topic.status, date: round.updatedOn,
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
    ...work, active: true, group: '来自灵感池', date: dayOnly.format(new Date(work.createdAt)),
    versions: [], history: Object.fromEntries(Object.keys(catalog.platforms).map(key => [key, []])),
    idea: ideas.get(work.ideaId), topic: {
      id: work.id, stage: 'listening', records: {}, channels: {},
      nextOwner: '把你亲历的细节保留在这篇里',
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
    const metadata = el('span', 'work-label', el('span', '', entry.active ? workStatusLabels[workProgress(entry).stage] :
      releases ? releases + '已发' : '历史归档'), el('span', 'number', entry.date ?? entry.id.toUpperCase()));
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
  const jobs = local.jobs.filter(job => job.entryId === entry.id && job.action !== 'delivery').reverse();
  if (!jobs.length) return null;
  const approvals = local.finals.filter(item => item.entryId === entry.id);
  const finalId = approvals.findLast(item => !item.withdrawnAt)?.jobId;
  const earlierFinals = new Set(approvals.filter(item => item.withdrawnAt).map(item => item.jobId));
  return el('div', 'work-history', ...jobs.map((job, index) => {
    const label = manuscriptTitle(job) + ' v' + job.version +
      (job.id === finalId ? ' · 定稿' : earlierFinals.has(job.id) ? ' · 曾定稿' :
        job.status === 'failed' ? ' · 生成失败' : job.status === 'running' ? ' · 生成中' : '');
    const item = el('details', 'work-card work-version', el('summary', '', el('strong', '', label),
      el('span', 'hint number', dateLabel(job.finishedAt ?? job.startedAt))),
      job.output && draftActions.includes(job.action) ? manuscriptStats(job, entry) : null,
      job.output ? articleBody(job.output) : el('p', 'status', job.error ?? 'Codex 正在处理。'));
    item.open = index === 0;
    return item;
  }));
}

function launchHint() {
  return el('p', 'hint', '当前是只读档案。要新增或修改，请在 Finder 双击同目录的「启动编辑台.command」。');
}

function topicFields(entry) {
  return [
    field('工作标题', 'title', 'text', { value: entry.title, maxLength: 88, required: true }),
    field('这篇的切入角度', 'angle', 'textarea', { value: entry.angle ?? '', maxLength: 1600 })
  ];
}

function refineWork(entry, locked) {
  if (!entry.ideaId) return null;
  const original = entry.idea;
  const source = el('details', 'work-card work-note', el('summary', '', '原灵感'), original ? el('p', '', original.title) : null,
    original?.note ? el('p', 'hint idea-note', original.note) : null, link('返回灵感池', '#ideas'));
  if (live && !locked) {
    const control = button('保存选题');
    control.type = 'submit';
    const status = el('p', 'status');
    status.setAttribute('role', 'status');
    const form = el('form', 'form', ...topicFields(entry), el('div', 'controls', control), status);
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

function workSteps(flow, entry) {
  const completed = new Set([
    flow.topicSelected ? 'topic' : '',
    flow.draft ? 'listening' : '',
    flow.final || flow.stage === 'final' ? 'draft' : '',
    flow.final ? 'final' : '',
    flow.prepared ? 'delivery' : '',
    flow.published ? 'verify' : ''
  ]);
  const feedback = el('p', 'status error');
  feedback.setAttribute('role', 'status');
  const active = stageLabels.findIndex(([key]) => key === flow.stage);
  const list = el('ol', 'work-steps', ...stageLabels.map(([key, label], index) => {
    const done = index < active && completed.has(key);
    const action = entry && live && canReturnTo(flow, key);
    const marker = el('span', 'work-step-mark', done ? '✓' : '');
    marker.setAttribute('aria-hidden', 'true');
    const step = el('li', '');
    step.dataset.status = done ? 'done' : 'pending';
    if (key === flow.stage) step.setAttribute('aria-current', 'step');
    if (action) {
      const control = el('button', 'work-step-action', marker, label);
      control.type = 'button';
      control.dataset.stage = key;
      control.title = '返回「' + label + '」重做';
      control.setAttribute('aria-label', control.title);
      control.addEventListener('click', async () => {
        const buttons = list.querySelectorAll('button');
        for (const item of buttons) item.disabled = true;
        feedback.textContent = '';
        try {
          await updateProduction('works/rework', { entryId: entry.id, stage: key, from: flow.stage,
            revisionOf: flow.draft?.id ?? null, confirmedAt: flow.approval?.confirmedAt ?? null }, true);
        } catch (error) {
          feedback.textContent = error.message;
          for (const item of buttons) item.disabled = false;
        }
      });
      step.append(control);
    } else step.append(marker, label);
    if (done) step.append(el('span', 'sr', '已完成'));
    return step;
  }));
  list.setAttribute('aria-label', '制作流程');
  if (!entry || !live) return list;
  const note = flow.locked ? (flow.delivered ? '平台交付已生成，流程已锁定。' : '已核实发布，流程已锁定。') :
    list.querySelector('button') ? '点选已完成的步骤重做。' : '';
  return el('div', 'work-timeline', list, note ? el('p', 'hint', note) : null, feedback);
}

const subheading = /^#{1,4} (.+)$/u;
const suggestedLength = (draft, entry) => wechatLengthRange(draft.materials || draft.ideaContext || entry.idea?.note || '').map(display).join('–');

function manuscriptStats(draft, entry) {
  const blocks = draftBlocks(draft.output);
  const words = draftWordCount(draft.output);
  const paragraphs = blocks.filter(block => !subheading.test(block.text)).length;
  const previous = local.jobs.find(job => job.id === draft.revisionOf && job.output && draftActions.includes(job.action));
  const change = previous ? words - draftWordCount(previous.output) : null;
  const total = el('span', 'work-word-count', '正文 ', el('strong', 'number', display(words)), ' 字');
  total.title = '每个汉字、英文词和连续数字各计一字，空格和标点不计。';
  return el('div', 'work-draft-stats', total, el('span', '', paragraphs + ' 段'),
    change === null ? null : el('span', '', '较上一稿 ' + (change > 0 ? '+' : '') + display(change) + ' 字'),
    el('span', 'work-length-guide', draft.lengthGuide?.target ? '公众号目标约 ' + display(draft.lengthGuide.target) + ' 字' :
      '公众号建议 ' + suggestedLength(draft, entry) + ' 字'));
}

function articleBody(text) {
  return el('article', 'work-article', ...draftBlocks(text).map(({ text }) => {
    const heading = text.match(subheading);
    return heading ? el('h3', '', heading[1]) : el('p', '', text);
  }));
}

function workForm(label, action, submit, fields = [], primary = false) {
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  const control = button(label, primary ? 'button primary' : 'button');
  control.type = 'submit';
  control.disabled = action !== 'refresh' && local.jobs.some(job => job.status === 'running');
  const form = el('form', fields.length ? 'form' : 'work-inline-form', ...fields, control, status);
  form.dataset.action = action;
  handleForm(form, status, submit);
  return form;
}

async function updateProduction(path, body, focusStage = false) {
  local = await api(path, body);
  render();
  poll();
  if (focusStage && route().entry?.id === body.entryId && route().panel === 'production') {
    const heading = document.querySelector('.work-main h2');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus();
    }
  }
}

function sendDraft(entry, action, previous, reviewContext, values = {}) {
  return updateProduction('drafts', { ...values, entryId: entry.id, action, revisionOf: previous?.id, reviewContext });
}

function workJobStatus(flow) {
  const last = flow.jobs.at(-1);
  if (!last || last.status === 'done' || (last.action === 'delivery' && !flow.final) ||
      (flow.rework === 'listening' && last.action !== 'draft')) return null;
  const labels = { draft: '正在写初稿', revise: '正在修改稿件', polish: '正在改口吻', delivery: '正在准备平台交付' };
  const note = el('p', last.status === 'failed' ? 'status error work-run-status' : 'status work-run-status',
    last.status === 'failed' ? last.error ?? '本次任务未完成。' : 'Codex ' + (labels[last.action] ?? '正在处理') + '…');
  note.setAttribute('role', 'status');
  return note;
}

function firstDraft(entry, flow, reviewContext) {
  const topic = entry.topic;
  const note = flow.rework === 'listening' ? '可以沿用已有素材，也可以补充后再写一版初稿。' :
    flow.outline ? '可以沿用原素材和已保存的提纲，直接写初稿。' :
    entry.idea?.note ? '可以直接按原灵感写初稿。' : topic.question;
  const previous = flow.draft ?? flow.outline;
  const materials = previous?.materials ?? '';
  const more = el('details', 'record-toggle work-add-material', el('summary', '', '补充素材或指令（选填）'),
    field('补充素材', 'materials', 'textarea', { maxLength: 12000, value: materials }),
    field('本次指令', 'instructions', 'text', { maxLength: 2000 }));
  return el('section', 'work-card work-main', head(flow.stage === 'topic' ? '确定选题' : '听你讲'),
    el('p', 'hint', note), workJobStatus(flow),
    live ? workForm(flow.draft ? '重新生成初稿' : '生成初稿', 'draft',
      values => sendDraft(entry, 'draft', previous, reviewContext, values), [more], true) : launchHint());
}

function revisionEditor(entry, draft, reviewContext) {
  const full = el('input');
  Object.assign(full, { type: 'radio', name: 'scope', value: 'whole', checked: true });
  const small = el('input');
  Object.assign(small, { type: 'radio', name: 'scope', value: 'local' });
  const scopes = el('fieldset', 'work-revision-scope', el('legend', '', '修改范围'),
    el('label', 'work-revision-option', full, '整篇调整'),
    el('label', 'work-revision-option', small, '小范围修改'));

  const paragraph = el('select');
  paragraph.name = 'paragraph';
  const unselected = el('option', '', '请选择一段');
  unselected.value = '';
  paragraph.append(unselected, ...draftBlocks(draft.output).map(({ text }, index) => {
    const summary = text.replace(/\s+/gu, ' ');
    const option = el('option', '', '第 ' + (index + 1) + ' 段 · ' + summary.slice(0, 34) + (summary.length > 34 ? '…' : ''));
    option.value = String(index);
    return option;
  }));
  const quote = field('原句或词语（可选）', 'quote', 'text', { maxLength: 2000, placeholder: '粘贴稿件中的原文' });
  const target = el('div', 'work-revision-target', el('label', '', '要修改的段落', paragraph), quote,
    el('p', 'hint', '可选一段或粘贴原文。两者都填时，只定位该段中的原文。'));
  const length = field('公众号目标字数（可选）', 'targetWords', 'number', {
    min: '1', max: '20000', step: '1', value: draft.lengthGuide?.target ?? '', placeholder: '按素材建议 ' + suggestedLength(draft, entry) + ' 字'
  });
  const targetWords = length.querySelector('input');
  const quoteInput = quote.querySelector('input');
  const instructions = field('这次需要怎么改？', 'instructions', 'textarea', { required: true, maxLength: 2000 });
  const edit = workForm('提交修改意见', 'revise', values => sendDraft(entry, 'revise', draft, reviewContext, values),
    [scopes, length, target, instructions], true);
  edit.classList.add('work-revision-form');
  edit.id = 'work-revise';
  edit.hidden = true;
  const sync = () => {
    length.hidden = targetWords.disabled = small.checked;
    target.hidden = paragraph.disabled = quoteInput.disabled = !small.checked;
    edit.elements.instructions.placeholder = small.checked ? '例如，把术语换成日常说法' : '例如，先讲经过，再展开我的判断和做法';
  };
  scopes.addEventListener('change', sync);
  sync();
  return edit;
}

function manualEditor(entry, draft, close) {
  const label = field('编辑正文', 'article', 'textarea', {
    value: draft.output, required: true, maxLength: Math.max(articleLimit, draft.output.length)
  });
  const input = label.querySelector('textarea');
  const original = input.value;
  const stats = el('div', '', manuscriptStats(draft, entry));
  const cancel = button('取消编辑');
  cancel.type = 'button';
  const form = workForm('保存为新版本', 'manual', async ({ article }) => {
    cancel.disabled = input.readOnly = true;
    try {
      await updateProduction('works/edit', { entryId: entry.id, revisionOf: draft.id, article }, true);
    } finally {
      cancel.disabled = input.readOnly = false;
    }
  }, [label, stats], true);
  form.id = 'work-manual';
  form.classList.add('work-revision-form', 'work-manual-form');
  form.hidden = true;
  const submit = form.querySelector('button[type="submit"]');
  const busy = submit.disabled;
  const actions = el('div', 'work-controls', cancel);
  submit.replaceWith(actions);
  actions.prepend(submit);
  const sync = () => {
    submit.disabled = busy || input.value === original || !input.value.trim();
    stats.replaceChildren(manuscriptStats({ ...draft, output: input.value, revisionOf: draft.id }, entry));
  };
  input.addEventListener('input', sync);
  cancel.addEventListener('click', () => {
    input.value = original;
    form.querySelector('.status').textContent = '';
    sync();
    close();
  });
  sync();
  return form;
}

function draftReview(entry, flow, reviewContext, timeline) {
  const { draft } = flow;
  const controls = el('div', 'work-controls');
  const stats = manuscriptStats(draft, entry);
  const article = articleBody(draft.output);
  const edit = revisionEditor(entry, draft, reviewContext);
  const revise = button('继续修改');
  revise.type = 'button';
  revise.setAttribute('aria-expanded', 'false');
  revise.setAttribute('aria-controls', edit.id);
  revise.addEventListener('click', () => {
    edit.hidden = !edit.hidden;
    revise.setAttribute('aria-expanded', String(!edit.hidden));
    if (!edit.hidden) edit.elements.instructions.focus();
  });
  let manual;
  if (live && !flow.locked) {
    const open = button('编辑正文');
    open.type = 'button';
    open.disabled = local.jobs.some(job => job.status === 'running');
    open.setAttribute('aria-controls', 'work-manual');
    open.setAttribute('aria-expanded', 'false');
    manual = manualEditor(entry, draft, () => setEditing(false));
    function setEditing(editing) {
      manual.hidden = !editing;
      timeline.inert = controls.hidden = stats.hidden = article.hidden = editing;
      edit.hidden = true;
      revise.setAttribute('aria-expanded', 'false');
      open.setAttribute('aria-expanded', String(editing));
      if (editing) manual.elements.article.focus();
      else open.focus();
    }
    open.addEventListener('click', () => setEditing(true));
    controls.append(open, revise, workForm('改口吻', 'polish', () => sendDraft(entry, 'polish', draft, reviewContext)),
      workForm('确认定稿', 'final', () => updateProduction('works/final', { entryId: entry.id, jobId: draft.id }), [], true));
  }
  const status = flow.stage === 'final' ? '待定稿' : '待审';
  return el('section', 'work-card work-main', head(manuscriptTitle(draft), 'v' + draft.version + ' · ' + status),
    stats, !live ? launchHint() : controls, live ? edit : null, manual, workJobStatus(flow), article);
}

function copyControl(copyLabel, text, preview) {
  const control = button(copyLabel);
  control.type = 'button';
  const status = el('p', 'status');
  status.setAttribute('role', 'status');
  control.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = '已复制。';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(preview);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      status.textContent = '已选中，请手动复制。';
    }
  });
  return [control, status];
}

function workCopy(label, text, copyLabel) {
  const preview = el('pre', 'work-copy-text', text);
  const details = el('details', 'record-toggle', el('summary', '', label), preview);
  details.append(...copyControl(copyLabel, text, preview));
  return details;
}

function deliveryDialog(title, content, className = '') {
  const opener = document.activeElement;
  const heading = el('h2', '', title);
  heading.id = 'delivery-dialog-title';
  const close = button('关闭', 'button ghost');
  close.type = 'button';
  close.autofocus = true;
  const dialog = el('dialog', 'delivery-dialog ' + className,
    el('header', 'delivery-dialog-head', heading, close), el('div', 'delivery-dialog-content', content));
  dialog.setAttribute('aria-labelledby', heading.id);
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => {
    dialog.remove();
    (opener?.isConnected ? opener : at('detail'))?.focus({ preventScroll: true });
  });
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function deliveryAction(label, action, className = 'button') {
  const control = button(label, className);
  control.type = 'button';
  control.addEventListener('click', action);
  return control;
}

function wechatCoverPreview(covers) {
  const first = covers?.findIndex(cover => cover.versions.length) ?? -1;
  return first === -1 ? null : deliveryAction('预览公众号封面', () => imageHistory(first, covers, '公众号封面与版本'));
}

function wechatEditorLink(deliveryId, returnPanel = 'production') {
  const query = new URLSearchParams({ deliveryId, view: 'edit', returnPanel });
  const edit = link('编辑公众号排版', './公众号排版.html?' + query, returnPanel === 'publish' ? 'button' : 'button primary');
  edit.target = '_blank';
  edit.rel = 'noopener';
  return edit;
}

function openWechatLayout(deliveryId, returnPanel = 'production') {
  const title = '公众号排版预览';
  const frame = el('iframe', 'delivery-wechat-frame');
  const query = new URLSearchParams({ deliveryId, view: 'preview', returnPanel });
  frame.src = './公众号排版.html?' + query;
  frame.title = title;
  frame.referrerPolicy = 'no-referrer';
  deliveryDialog(title, frame, 'delivery-wechat-dialog');
}

function douyinPreview(plan, path) {
  const tags = plan.tags.map(tag => '#' + tag).join(' ');
  const title = el('p', 'delivery-post-title', plan.title);
  const count = douyinTitleLength(plan.title);
  const caption = el('div', 'delivery-post-description', el('p', '', plan.caption), el('p', 'delivery-tags', tags));
  const download = link('下载发布文案', path, 'button');
  if (download) download.download = '抖音图文.md';
  deliveryDialog('抖音发布文案', el('div', 'delivery-copy delivery-publish-copy',
    el('section', 'delivery-copy-field',
      el('div', 'delivery-copy-heading', el('h3', '', '发布标题'), el('span', count > douyinTitleLimit ? 'error' : 'hint', count + ' / ' + douyinTitleLimit + ' 字')),
      title, el('div', 'work-controls', ...copyControl('复制标题', plan.title, title))),
    el('section', 'delivery-copy-field',
      el('div', 'delivery-copy-heading', el('h3', '', '发布配文'), el('span', 'hint', plan.tags.length + ' 个话题')),
      caption, el('div', 'work-controls', ...copyControl('复制配文和话题', plan.caption + '\n\n' + tags, caption), download))));
}

const imageVersionLabel = version => version ? 'v' + version : '本地原图';
const imagePending = task => ['queued', 'running'].includes(task?.status);
const numberLabel = index => String(index + 1).padStart(2, '0');

function deliveryImage(version, alt, className) {
  const img = el('img', className);
  img.src = version.url;
  img.alt = alt;
  return img;
}

function imageHistory(index, gallery, title = '图片预览与版本') {
  const pages = gallery.flatMap((item, page) => item?.versions?.length ? [{ page, versions: item.versions }] : []);
  let active = pages.findIndex(item => item.page === index);
  const previous = deliveryAction('‹', () => showPage(active - 1), 'button delivery-image-arrow');
  const next = deliveryAction('›', () => showPage(active + 1), 'button delivery-image-arrow');
  previous.title = '上一张';
  next.title = '下一张';
  previous.setAttribute('aria-label', previous.title);
  next.setAttribute('aria-label', next.title);
  const count = el('p', 'hint number delivery-image-count');
  count.setAttribute('role', 'status');
  const image = el('div', 'delivery-image-stage');
  const navigation = el('div', 'delivery-image-navigation', previous, image, next);
  const meta = el('p', 'hint delivery-image-meta');
  const actions = el('div', 'work-controls delivery-version-options');
  const dialog = deliveryDialog(title, el('div', 'delivery-history', count, actions, meta, navigation));
  function showPage(position) {
    const item = pages[position];
    if (!item) return;
    active = position;
    const focused = document.activeElement;
    const { page, versions } = item;
    const coverLabel = gallery[page].label;
    const label = coverLabel ?? '第 ' + (page + 1) + ' 张';
    const versionLabel = version => coverLabel && !version.version ? '旧版 · 无标题' : imageVersionLabel(version.version);
    const current = versions.at(-1);
    previous.disabled = active === 0;
    next.disabled = active === pages.length - 1;
    if (focused === previous && previous.disabled && !next.disabled) next.focus({ preventScroll: true });
    if (focused === next && next.disabled && !previous.disabled) previous.focus({ preventScroll: true });
    count.textContent = coverLabel ? coverLabel + ' · ' + (page + 1) + ' / ' + gallery.length : '第 ' + (page + 1) + ' / ' + gallery.length + ' 张';
    const download = link('下载所选图片', current.url, 'button');
    const options = versions.slice().reverse().map(version => deliveryAction(versionLabel(version) +
      (version === current ? ' · 当前' : ''), () => showVersion(version)));
    function showVersion(version) {
      image.replaceChildren(deliveryImage(version, label + ' ' + versionLabel(version), 'delivery-image-preview'));
      meta.textContent = [version.width + ' × ' + version.height, version.createdAt ? dateLabel(version.createdAt) : '', version.note]
        .filter(Boolean).join(' · ');
      download.href = version.url;
      download.download = version.filename ?? numberLabel(page) + '-' + imageVersionLabel(version.version) + '.png';
      options.forEach((option, at) => option.setAttribute('aria-pressed', String(versions[versions.length - at - 1] === version)));
    }
    actions.replaceChildren(...options, download);
    showVersion(current);
  }
  dialog.addEventListener('keydown', event => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    showPage(active + (event.key === 'ArrowLeft' ? -1 : 1));
  });
  showPage(active);
}

function reviseImage(deliveryId, index, version, cover) {
  const issue = field('这张图怎么改（选填）', 'note', 'textarea', {
    maxLength: 1200, placeholder: '例如，把标题移到上方、减弱背景细节，或修正图中的错字'
  });
  const form = workForm('提交并重新生成', 'image-revise', async ({ note }) => {
    await updateProduction(cover ? 'delivery/wechat/covers' : 'delivery/images',
      { deliveryId, ...(cover ? { cover: cover.id } : { page: index }), baseVersion: version.version, note });
    dialog.close();
  }, [issue], true);
  const reference = deliveryImage(version, '当前图片', 'delivery-revision-reference');
  if (cover) reference.style.aspectRatio = String(cover.width / cover.height);
  const dialog = deliveryDialog(cover ? '修改' + cover.label : '修改第 ' + (index + 1) + ' 张图',
    el('div', 'delivery-image-revision', reference, form));
}

function wechatCoverReady(cover) {
  return Boolean(cover.versions.at(-1)?.version);
}

function wechatCoverPanel(deliveryId, covers) {
  if (!covers?.length) return null;
  const done = covers.filter(wechatCoverReady).length;
  const pending = covers.filter(cover => imagePending(cover.task)).length;
  const count = el('span', 'hint', done + ' / ' + covers.length + ' 张已就绪' + (pending ? ' · 正在处理 ' + pending + ' 张' : ''));
  count.setAttribute('role', 'status');
  const missing = covers.some(cover => !wechatCoverReady(cover) && !imagePending(cover.task));
  const fill = live && missing ? workForm(done ? '补齐封面' : '生成带标题的封面',
    'wechat-cover-batch', () => updateProduction('delivery/wechat/covers', { deliveryId })) : null;
  const cards = covers.map((cover, index) => {
    const { id, label, width, height, versions, task } = cover;
    const current = versions.at(-1);
    const busy = imagePending(task);
    const history = () => imageHistory(index, covers, '公众号封面与版本');
    const thumbnail = current ? deliveryAction('', history, 'delivery-cover-thumbnail') :
      el('div', 'delivery-cover-thumbnail delivery-cover-empty', width + ' × ' + height);
    const download = current ? link('下载', current.url, 'button ghost') : null;
    const revise = current && !busy && live ?
      deliveryAction('修改并重生成', () => reviseImage(deliveryId, index, current, cover), 'button ghost') : null;
    const versionsLink = current ? deliveryAction('版本历史', history, 'button ghost') : null;
    const retry = !current && !busy && live ? workForm(task?.status === 'failed' ? '重试此图' : '生成此图',
      'wechat-cover-single', () => updateProduction('delivery/wechat/covers', { deliveryId, cover: id })) : null;
    if (current) {
      thumbnail.append(deliveryImage(current, '', ''));
      thumbnail.setAttribute('aria-label', '预览' + label);
      download.download = current.filename;
      download.setAttribute('aria-label', '下载' + label);
      revise?.setAttribute('aria-label', '修改并重生成' + label);
      versionsLink.setAttribute('aria-label', label + '版本历史');
    }
    const version = wechatCoverReady(cover) ? imageVersionLabel(current.version) : current ? '旧版 · 无标题' : '待出图';
    const status = task?.status === 'running' ? '正在出图' : task?.status === 'queued' ? '排队中' :
      task?.status === 'failed' ? (current ? '重生成失败 · ' + version : '生成失败') : version;
    return el('li', 'delivery-cover', thumbnail,
      el('div', 'delivery-cover-caption', el('h4', '', label), el('span', 'hint', width + ' × ' + height + ' · ' + status)),
      task?.error ? el('p', 'status error', task.error) : null,
      el('div', 'delivery-page-actions', retry, download, revise, versionsLink));
  });
  return el('div', 'delivery-wechat-covers',
    el('div', 'delivery-copy-heading', el('h3', '', '公众号封面'), count), el('ul', 'delivery-cover-grid', ...cards), fill);
}

function deliveryPageCard(deliveryId, page, index, gallery) {
  const item = gallery[index];
  const versions = item?.versions ?? [];
  const current = versions.at(-1);
  const task = item?.task;
  const busy = imagePending(task);
  const history = () => imageHistory(index, gallery);
  const thumbnail = current ? deliveryAction('', history, 'delivery-thumbnail') :
    el('span', 'delivery-thumbnail delivery-thumbnail-empty', numberLabel(index));
  if (current) {
    thumbnail.setAttribute('aria-label', '查看第 ' + (index + 1) + ' 张图片');
    const image = deliveryImage(current, '', '');
    image.loading = 'lazy';
    thumbnail.append(image);
  }
  const label = task?.status === 'running' ? '正在出图' : task?.status === 'queued' ? '排队中' :
    task?.status === 'failed' ? (current ? '重生成失败 · ' + imageVersionLabel(current.version) : '生成失败') :
    current ? '已生成 · ' + imageVersionLabel(current.version) : '待出图';
  const retry = !current && !busy && live ? workForm(task?.status === 'failed' ? '重试本页' : '生成此图', 'image-page',
    () => updateProduction('delivery/images', { deliveryId, page: index })) : null;
  return el('li', 'delivery-page', thumbnail,
    el('div', 'delivery-page-info', el('span', 'hint number', '第 ' + (index + 1) + ' 页'),
      el('h3', '', page.title), el('p', 'hint delivery-page-status', label),
      task?.error ? el('p', 'status error', task.error) : null,
      el('div', 'delivery-page-actions', retry,
        current && live && !busy ? deliveryAction('修改并重生成', () => reviseImage(deliveryId, index, current), 'button ghost') : null,
        current ? deliveryAction('版本历史', history, 'button ghost') : null)));
}

function platformDelivery(entry, flow) {
  const { final, delivery, files } = flow;
  const page = el('section', 'work-card work-main', head(flow.stage === 'verify' ? '发布核验' : '平台交付', '定稿 v' + final.version),
    manuscriptStats(final, entry), workJobStatus(flow),
    el('details', 'record-toggle work-note', el('summary', '', '查看确认的定稿'), articleBody(final.output)));
  if (!delivery) {
    page.append(live ? workForm('生成平台交付', 'delivery', () => sendDraft(entry, 'delivery', final, ''), [], true) : launchHint());
    return page;
  }
  const plan = delivery.delivery;
  const imageCount = files?.images.filter(Boolean).length ?? 0;
  const missing = plan.pages.length - imageCount;
  const generating = files?.gallery?.filter(item => imagePending(item.task)).length ?? 0;
  const generate = live && missing ? workForm(imageCount ? '补齐缺图' : '生成抖音图集', 'image-batch',
    () => updateProduction('delivery/images', { deliveryId: delivery.id }), [], true) : null;
  if (generate && generating) generate.querySelector('button').disabled = true;
  const progress = generating || !missing ? el('p', 'hint', generating ? 'Codex 正在处理 ' + generating + ' 张，完成后逐张显示。' :
    '图集已齐，可以逐张核对文字和画面。') : null;
  progress?.setAttribute('role', 'status');
  const gallery = el('ol', 'delivery-gallery', ...plan.pages.map((item, index) =>
    deliveryPageCard(delivery.id, item, index, files?.gallery ?? [])));
  page.append(
    el('section', 'work-delivery-module', head('公众号排版', local.wechatLayouts?.find(layout => layout.deliveryId === delivery.id)?.styleName),
      live ? el('div', 'work-controls',
        wechatEditorLink(delivery.id), deliveryAction('预览公众号排版', () => openWechatLayout(delivery.id)),
        wechatCoverPreview(files?.wechatCovers)) : launchHint(), wechatCoverPanel(delivery.id, files?.wechatCovers)),
    el('section', 'work-delivery-module', head('抖音图文', imageCount + ' / ' + plan.pages.length + ' 张本地图'),
      progress, el('div', 'work-controls', generate, deliveryAction('预览抖音发布文案', () => douyinPreview(plan, files?.copy))), gallery),
    link('去发布与数据核验', pathFor(entry, 'publish'), 'button primary'));
  return page;
}

function workReview(entry, flow) {
  const channels = flow.channels.map(([key, state]) => {
    const platform = catalog.platforms[key];
    const snapshot = state.snapshot;
    return el('section', 'work-delivery-module', head(platform.name, state.label),
      state.publication ? el('p', 'hint', '发布于 ' + publicationDate(state.publication)) : null,
      snapshot ? el('dl', 'metrics',
        homeMetric(key === 'douyin' ? '播放' : '阅读', display(firstMetric(snapshot, platform.primary))),
        homeMetric('收藏', display(firstMetric(snapshot, 'saves'))), homeMetric('分享', display(firstMetric(snapshot, 'shares')))) : null,
      el('p', 'hint', snapshot ? recordTime(snapshot) + ' · ' + snapshotWindow(snapshot) :
        state.publication ? '已有发布记录，等补充第一笔作品读数。' : '等核实这一平台的发布状态。'));
  });
  return el('section', 'work-card work-main', head('数据复盘'), ...channels,
    el('p', 'hint', '用同平台、同体裁和相近页数对照发布后 24、72、168 小时读数。'),
    el('div', 'work-controls', link('查看发布与完整读数', pathFor(entry, 'publish'), 'button primary'),
      link('回到运营概览', '#home', 'button')));
}

function production(entry, review, flow) {
  const reviewContext = review.hypothesis ? review.text : '';
  const reviewPanel = reviewContext ? el('details', 'work-card work-note draft-review',
    el('summary', '', '随创作提交的复盘建议'), el('pre', '', reviewContext)) : null;
  if (revealReviewFor === entry.id) {
    if (reviewPanel) reviewPanel.open = true;
    revealReviewFor = null;
  }
  const resumeText = [entry.topic.resume, reviewContext ?
    '进入创作阶段时，以作者确认的素材和本次指令为准。只在平台、体裁和修改范围适用时采用复盘建议，落实到相应的标题、首图或提纲。这是待验证的试验，历史读数只作编辑参考。\n' + reviewContext : '']
    .filter(Boolean).join('\n\n');
  const resume = workCopy('在 Codex 聊天里接着做', resumeText, '复制接续指令');
  resume.classList.add('work-card', 'work-note');
  const records = Object.values(entry.topic.records).map(record => link(record.label, record.file)).filter(Boolean);
  const sources = el('aside', 'work-sources', refineWork(entry, flow.locked || flow.final || flow.running || flow.rework === 'topic'), reviewPanel, resume,
    records.length ? el('details', 'work-card work-note', el('summary', '', '制作记录'),
      el('ul', 'attempts', ...records.map(record => el('li', '', record)))) : null,
    !entry.ideaId ? link('查看选题卡', './round-state.js') : null);
  const timeline = workSteps(flow, entry);
  const main = flow.stage === 'review' ? el('div', 'work-review-stack', workReview(entry, flow),
    flow.final ? platformDelivery(entry, flow) : null) : flow.final ? platformDelivery(entry, flow) :
    flow.rework === 'topic' ? el('section', 'work-card work-main', head('重定选题'),
      live ? workForm('确认选题', 'retopic', values => updateProduction('works/refine',
        { ...values, entryId: entry.id, confirmTopic: true }, true), topicFields(entry), true) : launchHint()) :
    flow.stage === 'draft' || flow.stage === 'final' ? draftReview(entry, flow, reviewContext, timeline) :
    firstDraft(entry, flow, reviewContext);
  return el('div', 'work-production', timeline, el('div', 'work-content', main, sources));
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
  const outlineCount = local.jobs.filter(job => job.entryId === entry.id && job.status === 'done' && job.action !== 'delivery').length;
  const saved = entry.versions.length + outlineCount;
  return el('section', '', head('稿件版本', saved + ' 个本地版本'), entry.versions.length ? list : !jobs ? el('p', 'empty', '还没有已存的稿件。') : null, sourceLinks, preview, jobs);
}

function publicationCheck(entry, key) {
  const id = entry.id + '/' + key;
  const platform = catalog.platforms[key];
  const pending = '正在用 Chrome 读取' + platform.name + '后台…';
  const feedback = checkFeedback?.id === id ? checkFeedback : null;
  const status = el('p', 'status channel-check-status', checkingPublication === id ? pending : feedback?.note);
  status.id = 'check-result-' + key;
  status.tabIndex = -1;
  status.setAttribute('role', 'status');
  status.classList.toggle('error', feedback?.state === 'unavailable');
  const control = deliveryAction('自动核验', async () => {
    if (checkingPublication) return;
    checkingPublication = id;
    checkFeedback = null;
    status.textContent = pending;
    status.classList.remove('error');
    control.textContent = '核验中…';
    document.querySelectorAll('.channel-verify').forEach(button => { button.disabled = true; });
    try {
      const { result, data } = await api('checks/verify', { entryId: entry.id, platform: key });
      local = data;
      checkFeedback = { id, ...result };
    } catch (error) {
      checkFeedback = { id, state: 'unavailable', note: error.message };
    } finally {
      checkingPublication = undefined;
      const view = route();
      render();
      if (view.entry?.id === entry.id && view.panel === 'publish') at(status.id)?.focus({ preventScroll: true });
    }
  }, 'button primary channel-verify');
  control.disabled = Boolean(checkingPublication);
  if (checkingPublication === id) control.textContent = '核验中…';
  control.setAttribute('aria-label', '自动核验' + platform.name);
  control.setAttribute('aria-describedby', status.id);
  return { control, status };
}

function publicationPreview(entry, key, flow) {
  const channelPackage = entry.topic?.channels[key]?.packageFile;
  const existing = link('打开本地交付', channelPackage, 'button');
  if (!flow?.delivery || !live) return existing;
  const { delivery, files } = flow;
  const folderStatus = el('span', 'status');
  folderStatus.setAttribute('role', 'status');
  const openFolder = deliveryAction('查看本地文件', async () => {
    openFolder.disabled = true;
    folderStatus.classList.remove('error');
    folderStatus.textContent = '正在打开 Finder…';
    try {
      await api('delivery/folder', { deliveryId: delivery.id, platform: key });
      folderStatus.textContent = '已打开 Finder。';
    } catch (error) {
      folderStatus.classList.add('error');
      folderStatus.textContent = error.message;
    } finally {
      openFolder.disabled = false;
    }
  });
  openFolder.setAttribute('aria-label', '查看本地文件 · ' + catalog.platforms[key].name);
  if (key === 'wechat') return el('div', '',
    el('div', 'channel-previews', deliveryAction('预览公众号排版', () => openWechatLayout(delivery.id, 'publish')),
      wechatEditorLink(delivery.id, 'publish'), wechatCoverPreview(files?.wechatCovers), openFolder, existing, folderStatus),
    wechatCoverPanel(delivery.id, files?.wechatCovers));
  const first = files?.gallery?.findIndex(item => item.versions?.length) ?? -1;
  return el('div', 'channel-previews', deliveryAction('预览抖音发布文案', () => douyinPreview(delivery.delivery, files?.copy)),
    first === -1 ? null : deliveryAction('预览抖音图片', () => imageHistory(first, files.gallery)), openFolder, existing, folderStatus);
}

function badge(record) {
  const tag = el('span', 'badge', record.label);
  tag.dataset.state = record.state ?? 'unknown';
  return tag;
}

function publicationPanel(entry, key, flow) {
  const platform = catalog.platforms[key];
  const state = statusFor(entry, key);
  const metrics = el('dl', 'metrics');
  for (const [metric, title] of [[platform.primary, key === 'douyin' ? '播放' : '阅读'], ['saves', '收藏'], ['likes', '点赞'], ['comments', '评论'], ['shares', '分享'], ['averageImages', '平均看图']]) {
    if (key === 'wechat' && metric === 'averageImages') continue;
    metrics.append(el('div', '', el('dt', '', title), el('dd', '', display(firstMetric(state.snapshot, metric)))));
  }
  const basis = state.publication ?
    (key === 'douyin' ? '后台显示：' : '后台原题：') + state.publication.title + ' · 发布 ' + publicationDate(state.publication) :
    key === 'wechat' && entry.versions.length ? '已有本地稿件，尚无公众号发布证据。' : '尚无可以确认发布的后台记录。';
  const check = live ? publicationCheck(entry, key) : null;
  const readLabel = state.snapshot ? el('p', 'hint', '数据：' + recordTime(state.snapshot) + ' · ' + (state.snapshot.window ?? '窗口未标'), ' ', link(recordBasis(state.snapshot), state.snapshot.source)) : null;
  const rows = state.observed.map(record => el('li', '',
    el('strong', '', (publishedStates[record.state] ?? '已记录') + ' · ' + recordTime(record)),
    el('span', 'hint', record.title ? record.title + ' ' : '', record.contentId ? 'ID ' + record.contentId + ' ' : '',
      record.note ? record.note + ' ' : '', link(recordBasis(record), record.source)),
    Object.keys(record.metrics ?? {}).length ? el('span', 'hint number', [`读数 ${display(firstMetric(record, platform.primary))}`, `收藏 ${display(firstMetric(record, 'saves'))}`, record.images != null ? record.images + ' 张图' : null].filter(Boolean).join(' · ')) : null));
  const details = el('details', 'record-toggle observations', el('summary', '', '核验记录（' + rows.length + '）'), rows.length ? el('ul', 'attempts', ...rows) : el('p', 'hint', '没有此篇的后台快照。'));
  return el('section', 'channel', el('div', 'section-head channel-head', el('h2', '', platform.name, badge(state)),
    el('div', 'channel-actions', check?.control, link('打开官方后台', platform.url, 'button'))),
    check?.status, !live ? launchHint() : null,
    el('p', 'hint', basis), state.recent && state.recent !== state.publication ? el('p', 'hint', '最近核验：' + publishedStates[state.recent.state] + ' · ' + recordTime(state.recent)) : null,
    metrics, readLabel, publicationPreview(entry, key, flow),
    state.publication && flow?.stage === 'review' ? link('查看数据复盘', pathFor(entry, 'production'), 'button') : null, details);
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
const homeSwipeRate = snapshot => typeof snapshot.metrics.swipeRate === 'number' ?
  display(snapshot.metrics.swipeRate) + '%' : display(snapshot.metrics.swipeRate);

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
    const cell = value => el('td', 'number', value);
    return el('tr', '', title, cell(display(metrics[platform.primary])),
      ...(douyin ? [cell(homeSwipeRate(snapshot)), cell(readingDepth(snapshot))] : []),
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
  const full = el('details', 'record-toggle home-evidence', el('summary', '', '查看完整建议及依据'), context);
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
    apply.prepend(homeIcon('arrow'));
    apply.addEventListener('click', () => {
      const selected = entries.find(entry => entry.active && pathFor(entry, 'production') === at('nav-works').getAttribute('href')) ?? current;
      revealReviewFor = selected.id;
      location.hash = pathFor(selected, 'production');
    });
  }
  const sentence = edit.indexOf('。');
  const lead = sentence === -1 ? edit : edit.slice(0, sentence + 1);
  const rest = sentence === -1 ? '' : edit.slice(sentence + 1);
  const separator = lead.indexOf('：');
  const evidenceBrief = latestDouyin?.metrics.averageImages != null ?
    '最近一篇平均看图 ' + readingDepth(latestDouyin) + '。' : '';
  return el('aside', 'home-card analysis-next', el('div', 'home-card-head',
    el('div', 'home-action-title', el('span', 'home-action-icon', homeIcon('ideas')), el('h2', '', '今日行动')),
    el('span', 'home-tag', hypothesis ? '待验证' : '待补数据')),
    el('div', 'home-action-body',
      el('p', 'home-action-cue', separator === -1 ? '下篇先试一件事' : lead.slice(0, separator)),
      el('h3', '', lead.slice(separator + 1)),
      rest || evidenceBrief ? el('p', 'home-action-note', rest + evidenceBrief) : null,
      el('div', 'controls', apply, copy), feedback, full));
}

const homeGlyphs = {
  readings: 'M12 2.5 21.5 12 12 21.5 2.5 12Zm0 5L16.5 12 12 16.5 7.5 12Z',
  ideas: 'M12 2.5c.9 6 3.5 8.6 9.5 9.5-6 .9-8.6 3.5-9.5 9.5-.9-6-3.5-8.6-9.5-9.5 6-.9 8.6-3.5 9.5-9.5Z',
  works: 'M4 3h16v18H4zm0 6h16m-16 6h16',
  monitor: 'M12 2.5a9.5 9.5 0 1 1 0 19 9.5 9.5 0 0 1 0-19Zm0 3a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13Z',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M7 17 17 7M9 7h8v8',
  forward: 'M4 12h15m-6-6 6 6-6 6',
  clock: 'M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm0 4v5l3 2',
  douyin: 'M10 17V5c1.5 3 3.8 4.3 6 4.7M10 17a3 3 0 1 1-3-3c1.7 0 3 1.3 3 3Z',
  wechat: 'M5 5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 4v-4H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Zm3 5h8m-8 3h5',
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

function homeCover(row, variant) {
  const placeholder = el('span', 'home-cover-placeholder',
    variant === 'feature' ? el('span', 'home-cover-kicker', catalog.platforms[row.key].name + ' · 作品') : null,
    el('strong', 'home-cover-title', rowTitle(row)),
    variant === 'feature' ? el('span', 'home-cover-caption', '封面占位') : null);
  const frame = el('span', 'home-cover home-cover-' + variant, placeholder);
  frame.setAttribute('aria-hidden', 'true');
  frame.title = '暂无已核实封面';
  const source = row.entry.cover;
  if (!source) return frame;
  const image = el('img');
  image.alt = '';
  image.decoding = 'async';
  const portrait = el('span', 'home-cover-portrait', image);
  portrait.hidden = true;
  image.addEventListener('load', () => {
    placeholder.hidden = true;
    portrait.hidden = false;
    frame.dataset.hasCover = 'true';
    frame.title = '作品封面';
  }, { once: true });
  image.addEventListener('error', () => { portrait.remove(); frame.title = '封面未能读取'; }, { once: true });
  image.src = source;
  frame.append(portrait);
  return frame;
}

const homeStatusText = { loading: '正在读取本机记录', ready: '本机记录', archive: '离线作品档案', error: '未能刷新 · 保留已有记录' };
function homeStatus(mode) {
  homeReadMode = mode;
  const label = at('home-data-status');
  if (label) {
    label.dataset.mode = mode;
    const text = homeStatusText[mode];
    if (label.textContent !== text) label.textContent = text;
  }
}

function openHomeReadings(raw) {
  raw.open = true;
  raw.querySelector('summary').focus({ preventScroll: true });
  raw.scrollIntoView({ block: 'start', behavior: reducedMotion.matches ? 'auto' : 'smooth' });
}

function homeKpis(badges, raw) {
  const values = new Map(badges.map(([id, , value]) => [id, value]));
  const cards = [
    ['nav-home', '有读数的作品', '篇', '跨渠道按作品去重', 'readings'],
    ['nav-ideas', '在池灵感', '条', '未删除，含已建作品', 'ideas', '#ideas'],
    ['nav-works', '作品总数', '篇', '含在制与历史归档', 'works', at('nav-works').getAttribute('href')],
    ['nav-monitor', '发布监测记录', '条', '按作品与渠道计数', 'monitor', '#monitor']
  ];
  const panel = el('section', 'home-kpis');
  panel.setAttribute('aria-label', '核心运营指标');
  for (const [id, label, unit, note, icon, target] of cards) {
    const card = target ? link('', target, 'home-kpi') : button('', 'home-kpi');
    if (!target) {
      card.type = 'button';
      card.setAttribute('aria-controls', raw.id);
      card.addEventListener('click', () => openHomeReadings(raw));
    }
    card.setAttribute('aria-label', label + '：' + display(values.get(id)) + ' ' + unit + '。' + note + '，' + (target ? '打开对应页面' : '查看详细读数'));
    card.append(el('div', 'home-kpi-label', label, homeIcon(icon)),
      el('div', 'home-kpi-total', el('strong', 'home-kpi-value number', display(values.get(id))), el('span', 'home-kpi-unit', unit)),
      el('span', 'home-kpi-note', note), el('span', 'home-kpi-mark', homeIcon(icon)));
    panel.append(card);
  }
  return panel;
}

function homeEmpty(title, detail) {
  return el('div', 'home-empty', homeIcon('profile'), el('div', '', el('strong', '', title), el('p', '', detail)));
}

function homeDate(row) {
  const snapshot = row.state.snapshot;
  return publishedTime(row) ? dateLabel(snapshot.publishedAt ?? row.state.publication?.publishedAt) : recordTime(snapshot);
}

function homeMetric(label, ...value) {
  return el('div', '', el('dt', '', label), el('dd', 'number', ...value));
}

function homeTextLink(label, href, glyph = 'forward') {
  const anchor = link(label, href, 'home-text-link');
  anchor.append(homeIcon(glyph));
  return anchor;
}

function homeFeature({ key, platform, samples }) {
  if (!samples.length) return homeEmpty('暂无作品读数', '核验后，已记录的作品会出现在这里。');
  const score = row => {
    const value = firstMetric(row.state.snapshot, platform.primary);
    return Number.isFinite(value) ? value : -Infinity;
  };
  const row = samples.slice(0, 5).reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
  const snapshot = row.state.snapshot;
  const title = rowTitle(row);
  const heading = el('h3', 'home-feature-title', title);
  heading.title = title;
  const target = pathFor(row.entry, 'publish');
  const cover = link('', target, 'home-feature-cover-link');
  cover.setAttribute('aria-label', '查看发布数据：' + title);
  cover.append(homeCover(row, 'feature'));
  return el('div', 'home-feature-content', cover,
    el('div', 'home-feature-copy',
      el('div', 'home-feature-meta', el('span', 'home-feature-platform', homeIcon(key)), platform.name,
        el('span', 'home-meta-divider', '/'), homeDate(row)),
      heading,
      el('dl', 'home-feature-metrics',
        homeMetric(key === 'douyin' ? '播放' : '阅读', display(snapshot.metrics[platform.primary])),
        key === 'douyin' ? homeMetric('划走率', homeSwipeRate(snapshot)) : null,
        homeMetric('收藏 / 分享', display(snapshot.metrics.saves), el('small', '', ' / ' + display(snapshot.metrics.shares)))),
      el('div', 'home-feature-foot', el('span', '', '本机读数 · ' + snapshotWindow(snapshot)), homeTextLink('查看详情', target, 'arrow'))));
}

function homeRecent({ key, platform, samples }) {
  if (!samples.length) return homeEmpty('暂无可展示的近期表现', '记录读数后，作品和指标会出现在这里。');
  return el('ul', 'home-works', ...samples.slice(0, 3).map(row => {
    const snapshot = row.state.snapshot;
    const title = rowTitle(row);
    const entry = link('', pathFor(row.entry, 'publish'), 'home-work');
    entry.setAttribute('aria-label', '查看发布数据：' + title);
    const name = el('strong', 'home-work-title', title);
    name.title = title;
    entry.append(homeCover(row, 'thumb'),
      el('div', 'home-work-copy', name, el('p', 'home-work-meta', homeDate(row) + ' · ' + platform.name)),
      el('dl', 'home-work-metrics',
        homeMetric(key === 'douyin' ? '播放' : '阅读', display(snapshot.metrics[platform.primary])),
        key === 'douyin' ? homeMetric('划走率', homeSwipeRate(snapshot)) : homeMetric('收藏', display(snapshot.metrics.saves))));
    return el('li', '', entry);
  }));
}

function analysisHome(records, badges) {
  const measured = measuredRows(records);
  const workIds = new Set(local.works.map(work => work.id));
  const scoped = records.filter(row => workIds.has(row.entry.id));
  const progressed = new Set(scoped.filter(row => row.state.publication).map(row => row.entry.id)).size;
  const phases = [['入池灵感', allIdeas().length, 'ideas'], ['已建作品', workIds.size, 'works'],
    ['已核实发布', progressed, 'arrow'], ['已有读数', measuredCount(scoped), 'readings']];
  const flow = el('dl', 'analysis-flow', ...phases.map(([label, value, icon]) => el('div', 'home-funnel-step',
    el('dt', '', el('span', 'home-stage-icon', homeIcon(icon)), label), el('dd', 'number', display(value)))));
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
      homeTextLink('打开全部发布监测记录', '#monitor')));
  raw.id = 'home-raw';
  const read = button('查看作品读数', 'home-text-link');
  read.type = 'button';
  read.append(homeIcon('forward'));
  read.setAttribute('aria-controls', raw.id);
  read.addEventListener('click', () => openHomeReadings(raw));

  const status = el('span', 'home-data-status', homeStatusText[homeReadMode]);
  status.id = 'home-data-status';
  status.dataset.mode = homeReadMode;
  status.setAttribute('role', 'status');
  const observationTime = snapshot => Date.parse(snapshot?.capturedAt ?? snapshot?.receivedOn ?? '') || 0;
  const latest = measured.map(row => row.state.snapshot).sort((left, right) => observationTime(right) - observationTime(left))[0];
  const observationDate = observationTime(latest) ? dateLabel(latest.capturedAt ?? latest.receivedOn).slice(0, 10) : '';
  const create = link('新建作品', '#ideas', 'button primary home-create');
  create.prepend(homeIcon('plus'));
  create.setAttribute('aria-label', '新建作品，前往灵感池选题');
  const coverageLabel = el('p', 'home-muted');
  const feature = el('div', 'home-feature-body');
  const recent = el('div', 'home-recent-body');
  const recentCount = el('p', 'home-muted');
  const switcher = el('div', 'home-platforms');
  switcher.setAttribute('role', 'group');
  switcher.setAttribute('aria-label', '按平台查看内容表现与近期作品');
  for (const { key, platform } of groups) {
    const item = button(platform.name, 'home-platform');
    item.type = 'button';
    item.dataset.platform = key;
    item.addEventListener('click', () => {
      if (homePlatform !== key) {
        homePlatform = key;
        showPlatform();
        playMotion(feature, [{ opacity: .5 }, { opacity: 1 }], { duration: 175 });
        playMotion(recent, [{ opacity: .5 }, { opacity: 1 }], { duration: 175 });
      }
    });
    switcher.append(item);
  }
  function showPlatform() {
    const group = groups.find(item => item.key === homePlatform) ?? groups[0];
    for (const item of switcher.children) item.setAttribute('aria-pressed', String(item.dataset.platform === group.key));
    coverageLabel.textContent = group.platform.name + ' · ' + coverage(group);
    recentCount.textContent = group.samples.length ? '最近 ' + Math.min(3, group.samples.length) + ' 篇有读数的作品' : group.platform.name + ' · 作品读数';
    feature.replaceChildren(homeFeature(group));
    recent.replaceChildren(homeRecent(group));
  }
  showPlatform();
  return el('div', 'analysis-home',
    el('header', 'home-heading',
      el('div', '', el('p', 'home-eyebrow', 'CONTENT OPERATIONS', observationDate ? el('span', '', ' / ' + observationDate.replaceAll('-', '.')) : null),
        el('h1', '', '运营概览'), el('p', '', '汇总已有作品读数、内容进度与下一篇运营建议。')),
      el('div', 'home-heading-actions',
        el('div', 'home-freshness', homeIcon('clock'), status, observationDate ? el('span', '', '· ' + recordTime(latest)) : null), create)),
    homeKpis(badges, raw),
    el('div', 'analysis-grid home-top-grid',
      el('section', 'home-card home-performance',
        el('div', 'home-card-head', el('div', '', el('h2', '', '内容焦点', homeIcon('ideas')), coverageLabel), read),
        feature),
      nextExperiment(reviewSuggestion(measured))),
    el('div', 'analysis-grid home-bottom-grid',
      el('section', 'home-card home-recent',
        el('div', 'home-card-head', el('div', '', el('h2', '', '近期作品'), recentCount),
          el('div', 'home-recent-actions', switcher, homeTextLink('全部记录', '#monitor'))), recent),
      el('section', 'home-card analysis-path',
        el('div', 'home-card-head', el('div', '', el('h2', '', '灵感转化'), el('p', 'home-muted', '从灵感入池到获得作品读数')), homeTextLink('完整记录', '#ideas')),
        flow, el('p', 'home-funnel-foot', '含已删除灵感，作品仅统计从灵感池新建的记录。'))),
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
  const batch = local.ideaBatch;
  const generating = batch?.status === 'running';
  const generate = at('idea-generate');
  if (generate) {
    generate.disabled = generating;
    generate.textContent = generating ? '正在生成灵感…' : '生成 3 条灵感';
  }
  const daily = at('idea-daily');
  daily.textContent = local.dailyError || batch?.error || (generating ? 'Codex 正在准备 3 条候选' :
    generatedToday ? '今日已生成 ' + generatedToday + ' 条' : '点击生成可添加 Codex 候选');
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
  let generate;
  if (live) {
    generate = button('生成 3 条灵感', 'button primary');
    generate.id = 'idea-generate';
    generate.type = 'button';
    generate.addEventListener('click', async () => {
      generate.disabled = true;
      daily.textContent = '正在提交给 Codex…';
      try {
        local = await api('ideas/generate', {});
        ideaSource = source.value = 'all';
        ideaStatus = 'all';
        renderIdeas(true);
        poll();
      } catch (error) {
        daily.textContent = error.message;
        generate.disabled = false;
      }
    });
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
    el('div', 'pool-focus', daily, el('div', 'controls', shortcut, generate))),
    el('div', 'idea-grid',
      el('section', '', el('div', 'idea-toolbar', el('h2', '', '候选选题', count), label, source), filters, list, empty),
      input));
}

function render() {
  current = currentEntry();
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
  const flow = entry.active ? workProgress(entry) : null;
  if (flow && visiblePanel !== pathFor(entry, panel) && matchMedia('(max-width: 750px)').matches) at('library-panel').open = false;
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
  const sub = entry.ideaId ? entry.angle : entry.active ? entry.angle || '从亲历的工作出发，写清 AI 做了什么、人又判断了什么。' :
    sameTitle && !entry.sourcePlatformUnknown ? '' : '原作：' + entry.originalTitle + (entry.sourcePlatformUnknown ? '（原系列标记已发，平台未核）' : '');
  const heading = el('h1', '', entry.title);
  const clauses = entry.title.length > 15 && entry.title.match(/^([^，：。]{5,23}[，：])(.+)$/u);
  if (clauses && !entry.active) heading.replaceChildren(el('span', 'title-clause', clauses[1]), clauses[2]);
  const hero = el('header', entry.active ? 'hero work-hero' : 'hero',
    el('div', 'hero-meta', el('span', 'identifier', entry.id.toUpperCase()), el('span', '', flow ? entry.group : entry.group + ' · ' + entry.localStatus),
      flow ? el('span', 'work-state', workStatusLabels[flow.stage]) : null),
    heading, sub ? el('p', '', sub) : null);
  const content = panel === 'production' ? production(entry, reviewSuggestion(measuredRows(records)), flow) : panel === 'drafts' ? drafts(entry) :
    el('div', '', flow ? workSteps(flow) : null, ...Object.keys(catalog.platforms).map(key => publicationPanel(entry, key, flow)));
  swapPanel(detail, pathFor(entry, panel), hero, nav, content);
}

function poll() {
  clearTimeout(timer);
  const watching = local.jobs.some(job => job.status === 'running') || local.ideaBatch?.status === 'running' ||
    local.imageJobs?.some(job => job.status === 'queued' || job.status === 'running');
  if (!live || !watching) return;
  timer = setTimeout(async () => {
    try {
      const before = local;
      const next = await api('state');
      if (local !== before) { poll(); return; }
      const view = route();
      const manuscriptChanged = JSON.stringify(local.jobs.map(job => job.status)) !== JSON.stringify(next.jobs.map(job => job.status));
      const deliveryId = view.entry?.active ? manuscriptProgress(local, view.entry.topic).delivery?.id : null;
      const imageStatus = state => state.imageJobs?.filter(job => job.deliveryId === deliveryId).map(job => [job.id, job.status]);
      const imagesChanged = deliveryId && JSON.stringify(imageStatus(local)) !== JSON.stringify(imageStatus(next));
      const ideaCountChanged = local.dailyIdeas.length !== next.dailyIdeas.length;
      local = next;
      if (view.ideas) renderIdeas(ideaCountChanged);
      else if (manuscriptChanged || imagesChanged || view.home && ideaCountChanged) render();
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
    document.querySelector('.delivery-dialog[open]')?.close();
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
