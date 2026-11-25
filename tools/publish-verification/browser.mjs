import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tabScript = fileURLToPath(new URL('./chrome-tab.js', import.meta.url));
const readerScript = fileURLToPath(new URL('./read-page.swift', import.meta.url));

function run(command, args, timeout, input) {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { timeout, maxBuffer: 200_000 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout.trim());
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

const readableIssues = {
  closed: '请打开已经登录的 Chrome，再点自动核验。',
  'no-window': '请在 Chrome 打开一个普通窗口，再点自动核验。',
  permission: 'Chrome 页面无法读取。请在 macOS「隐私与安全性 → 辅助功能」允许启动工作台的应用读取界面，再重试。',
  login: '后台需要重新登录。请在 Chrome 完成登录后重试。',
  account: '当前登录的账号与工作台登记的账号不一致（或账号名称无法确认）。请核对 Chrome 中的账号。',
  identity: '没有确认后台登录状态。请留在已登录的 Chrome 后台页面，再点自动核验。',
  navigation: '已确认登录账号，尚未进入作品列表。可以打开后台确认页面已加载，再重试。',
  list: '已确认登录账号，作品列表未能读取。请让后台页面保持打开后重试。'
};

const browserIssue = code => ({ state: 'unavailable', note: readableIssues[code] ?? 'Chrome 后台页面读取失败，请查看页面后重试。' });

export async function readPublication({ platform, titles, caption, images, accountId, brand }) {
  if (process.platform !== 'darwin') return { state: 'unavailable', note: '当前系统无法连接这套 Chrome 核验工具。' };
  try {
    const tab = await run('/usr/bin/osascript', ['-l', 'JavaScript', tabScript, platform], 8_000);
    if (tab !== 'ok') return browserIssue(tab);
  } catch (error) {
    return { state: 'unavailable', note: error.message.includes('-1743') ?
      'macOS 拒绝了工作台切换 Chrome 标签页。请检查「隐私与安全性 → 自动化」中的 Chrome 权限。' :
      '未能切换到 Chrome 的官方后台。请确认 Chrome 窗口可用后重试。' };
  }
  try {
    const stdout = await run('/usr/bin/swift', [readerScript], 47_000, JSON.stringify({ platform, titles, caption, images, accountId, brand }));
    return interpretPublication(JSON.parse(stdout), platform);
  } catch (error) {
    return { state: 'unavailable', note: error.killed ?
      '读取 Chrome 后台超时。请先让后台页面加载完成，再点自动核验。' : '本机无法读取 Chrome 页面，请保持后台标签页可见后重试。' };
  }
}

const fieldNames = {
  播放: 'plays', 播放量: 'plays', 阅读: 'reads', 阅读量: 'reads',
  收藏: 'saves', 点赞: 'likes', 评论: 'comments', 分享: 'shares',
  平均浏览图片数: 'averageImages', 划走率: 'swipeRate', 文案展开率: 'expandRate', 吸粉量: 'follows'
};

function targetMetrics(fields, platform) {
  const metrics = {};
  for (let i = 0; i + 1 < fields.length; i += 1) {
    if (!Object.hasOwn(fieldNames, fields[i])) continue;
    const key = fieldNames[fields[i]];
    if (platform === 'douyin' ? key === 'reads' : !['reads', 'saves', 'likes', 'comments', 'shares'].includes(key)) continue;
    const raw = fields[i + 1];
    if (key === 'swipeRate' || key === 'expandRate') {
      if (/^\d+(?:\.\d+)?%$/u.test(raw) && parseFloat(raw) <= 100) metrics[key] = raw;
    } else {
      const count = /^(?:\d+|\d{1,3}(?:,\d{3})+)$/u.test(raw);
      const value = Number(raw.replaceAll(',', ''));
      if ((count && Number.isSafeInteger(value)) || (key === 'averageImages' && /^\d+(?:\.\d+)?$/u.test(raw) && Number.isFinite(value))) {
        metrics[key] = value;
      }
    }
  }
  return metrics;
}

function officialTime(label) {
  const match = label?.match(/^(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/u);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '00'] = match;
  const date = [year, month.padStart(2, '0'), day.padStart(2, '0')].join('-');
  const local = hour ? date + 'T' + [hour.padStart(2, '0'), minute, second].join(':') : date;
  const at = hour ? local + '+08:00' : date;
  const stamp = Date.parse(at);
  if (!Number.isFinite(stamp) || stamp > Date.now()) return null;
  return new Date(stamp + (hour ? 8 * 3600_000 : 0)).toISOString().startsWith(local) ? at : null;
}

export function interpretPublication(result, platform) {
  if (result.code === 'not_visible') return { state: 'not_visible',
    note: '已检查后台可读的 ' + result.inspected + ' 条作品，暂未匹配到这篇。' };
  if (result.code !== 'matched') return browserIssue(result.code);
  if (result.observations.length !== 1) return { state: 'partial_visible', note: '后台有多条匹配作品，无法确认是哪一条。' };
  const [match] = result.observations;
  if (match.status !== '已发布' && match.status !== '已发表') return {
    state: match.status === '定时发布' ? 'scheduled' : 'partial_visible',
    title: match.title, note: '后台显示「' + match.status + '」。'
  };
  const publishedAt = officialTime(match.date);
  const metrics = targetMetrics(match.fields, platform);
  const pages = platform === 'douyin' && match.fields.find(field => /^\d+\s*张图$/u.test(field));
  const verified = match.matchedBy === 'caption' ? '已按发布配文匹配并核实发布' : '已核实发布';
  return { state: 'published', title: match.title, publishedAt,
    publishedLabel: match.date, contentId: match.contentId, metrics,
    ...(pages ? { images: parseInt(pages, 10) } : {}),
    note: verified + (!publishedAt ? '，后台只显示日期片段。' :
      Object.keys(metrics).length ? '，已读取该作品的可见读数。' : '，暂无可明确识别的读数。') };
}
