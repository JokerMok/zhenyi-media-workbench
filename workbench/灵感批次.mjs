import { randomInt, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const dailyFile = fileURLToPath(new URL('./每日灵感.js', import.meta.url));
export const dailyPrefix = 'window.WORKBENCH_DAILY = ';
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', dateStyle: 'short' });
const normalize = title => title.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{Z}\s]/gu, '');
const themes = ['AI 初稿的核验', '工作中的一个小技巧', 'AI 省了哪一步却没省下一步', '产品经理的人机分工', '指令、素材和版本交接', '团队复用的门槛', '一次反直觉的失败复盘', '改过之后怎样证明真的好用'];
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

export function planDaily({ path = dailyFile, now = new Date() } = {}) {
  const day = beijingDay(now);
  const { ideas } = readDaily(path);
  const available = [...themes];
  const directions = Array.from({ length: 3 }, () => available.splice(randomInt(available.length), 1)[0]);
  return { day, alreadySaved: ideas.some(idea => idea.day === day), directions, recentTitles: ideas.slice(-18).map(idea => idea.title) };
}

export function saveDaily(batch, { path = dailyFile, now = new Date() } = {}) {
  const day = beijingDay(now);
  if (batch?.day !== day) throw new Error('灵感日期必须是今天（北京时间）。');
  const lock = path + '.lock';
  mkdirSync(lock);
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    const data = readDaily(path);
    if (data.ideas.some(idea => idea.day === day)) return { day, added: 0 };
    if (!Array.isArray(batch.ideas) || batch.ideas.length !== 3) throw new Error('每天保存三条不同的灵感。');
    const seen = new Set(data.ideas.slice(-18).map(idea => normalize(idea.title)));
    const fresh = batch.ideas.map((idea, index) => {
      const title = typeof idea?.title === 'string' ? idea.title.trim() : '';
      const note = typeof idea?.note === 'string' ? idea.note.trim() : '';
      const key = normalize(title);
      if (!key || title.length > 88 || !note || note.length > 360 || seen.has(key)) throw new Error('请补齐标题和切入点，并避免与近日灵感重复。');
      seen.add(key);
      return { id: 'codex-' + day + '-' + (index + 1), source: 'codex', day, title, note, createdAt: now.toISOString() };
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
