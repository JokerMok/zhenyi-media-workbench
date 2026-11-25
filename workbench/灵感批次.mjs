import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const dailyFile = fileURLToPath(new URL('./每日灵感.js', import.meta.url));
export const dailyPrefix = 'window.WORKBENCH_DAILY = ';
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' });
const normalize = title => title.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const recentLimit = 18;
const themes = [
  '学习与查资料（理解概念、读长文、找出处、备考、跨语言阅读）',
  '写作与沟通（邮件、会议、汇报、口述整理、改稿）',
  '办公与数据（表格、需求、资料整理、数据核对）',
  '编程与产品制作（原型、写代码、排障、测试、交付）',
  '图像音视频与创作（封面、配图、录音、字幕、剪辑）',
  '流程与自动化（重复任务、AI 助手、批处理、异常接手）',
  '生活与个人安排（行程、购买前比较、整理照片、个人计划）',
  '协作与交接（团队讨论、共享经验、审阅、责任分工）',
  '工具选择与使用成本（换工具、本地运行、隐私、时间和费用）'
];
const empty = { schema: 1, ideas: [] };

export const beijingDay = (date = new Date()) => dayFormat.format(date);

export function readDaily(path = dailyFile) {
  if (!existsSync(path)) return structuredClone(empty);
  const source = readFileSync(path, 'utf8').trim();
  if (!source.startsWith(dailyPrefix) || !source.endsWith(';')) throw new Error('每日灵感记录格式不正确。');
  const data = JSON.parse(source.slice(dailyPrefix.length, -1));
  if (data.schema !== 1 || !Array.isArray(data.ideas)) throw new Error('无法读取每日灵感记录。');
  return data;
}

export function planDaily({ path = dailyFile, now = new Date(), existingTitles = [] } = {}) {
  const day = beijingDay(now);
  const { ideas } = readDaily(path);
  const lastUsed = new Map(ideas.map((idea, index) => [idea.direction, index]));
  const directions = themes.map(theme => ({ theme, last: lastUsed.get(theme) ?? -1, order: randomInt(2 ** 32) }))
    .sort((left, right) => left.last - right.last || left.order - right.order)
    .slice(0, 3)
    .map(({ theme }) => theme);
  const recentTitles = [...new Set([...ideas.slice(-recentLimit).map(idea => idea.title), ...existingTitles]
    .filter(title => typeof title === 'string' && title.trim()))];
  return { day, alreadySaved: ideas.some(idea => idea.day === day), directions, recentTitles };
}

export function saveDaily(batch, { path = dailyFile, now = new Date(), repeat = false, recentTitles = [] } = {}) {
  const day = beijingDay(now);
  if (batch?.day !== day) throw new Error('灵感日期必须是今天（北京时间）。');
  const lock = path + '.lock';
  mkdirSync(lock);
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const data = readDaily(path);
    const savedToday = data.ideas.filter(idea => idea.day === day).length;
    if (!repeat && savedToday) return { day, added: 0 };
    if (!Array.isArray(batch.ideas) || batch.ideas.length !== 3) throw new Error('请返回三条不同的灵感。');
    const seen = new Set([...data.ideas.slice(-recentLimit).map(idea => idea.title), ...recentTitles].map(normalize));
    const fresh = batch.ideas.map((idea, index) => {
      const title = typeof idea?.title === 'string' ? idea.title.trim() : '';
      const note = typeof idea?.note === 'string' ? idea.note.trim() : '';
      const key = normalize(title);
      if (!key || title.length > 88 || !note || note.length > 360 || seen.has(key)) throw new Error('请补齐标题和切入点，并避开近期灵感和已有作品。');
      seen.add(key);
      const direction = batch.directions?.[index];
      return { id: 'codex-' + day + '-' + (savedToday + index + 1), source: 'codex', day, title, note,
        ...(themes.includes(direction) ? { direction } : {}), createdAt: now.toISOString() };
    });
    const next = dailyPrefix + JSON.stringify({ ...data, ideas: [...data.ideas, ...fresh] }, null, 2).replaceAll('<', '\\u003c') + ';\n';
    writeFileSync(temporary, next, { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
    return { day, added: fresh.length };
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
    rmdirSync(lock);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const action = process.argv[2];
    if (action === '--plan') console.log(JSON.stringify(planDaily()));
    else if (action === '--save') console.log(JSON.stringify(saveDaily(JSON.parse(readFileSync(0, 'utf8')))));
    else throw new Error('请指定 --plan 或 --save。');
  } catch (error) {
    console.error(error.code === 'EEXIST' ? '另一批灵感正在保存，请稍后查看。' : error.message);
    process.exitCode = 1;
  }
}
