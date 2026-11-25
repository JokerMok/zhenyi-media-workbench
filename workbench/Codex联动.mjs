import { spawn } from 'node:child_process';
import { existsSync, mkdtempDisposableSync, readFileSync, readdirSync, realpathSync, rmdirSync, statSync, unlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';

function runLocalCodex(prompt, { image = false, reference } = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const scratch = mkdtempDisposableSync(resolve(tmpdir(), 'zhenyi-codex-'));
    const artifact = resolve(scratch.path, 'answer.txt');
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !['CODEX_THREAD_ID', 'OPENAI_API_KEY', 'OPENAI_BASE_URL'].includes(key)));
    const args = ['exec', '--json', '--color', 'never', '--ephemeral', '--ignore-user-config',
      '--skip-git-repo-check', '--sandbox', 'read-only', '-C', scratch.path, '-o', artifact,
      '--disable', 'apps', '--disable', 'plugins', '--disable', 'remote_plugin', '--disable', 'hooks', '--disable', 'shell_tool',
      image ? '--enable' : '--disable', 'image_generation',
      '-c', 'web_search="disabled"', '-c', 'analytics.enabled=false', '-c', 'model_reasoning_effort="low"'];
    if (reference) args.push('--image=' + reference);
    args.push('--', '-');
    const child = spawn('codex', args, { cwd: scratch.path, env: environment, stdio: ['pipe', 'pipe', 'pipe'] });
    let threadId;
    let completed = false;
    let expired = false;
    let spawnError;
    let diagnosis = '';
    const collect = message => { diagnosis = (diagnosis + ' ' + message).slice(-8000); };
    const reader = createInterface({ input: child.stdout });
    reader.on('line', raw => {
      try {
        const event = JSON.parse(raw);
        if (event.type === 'thread.started') threadId = event.thread_id;
        if (event.type === 'turn.completed') completed = true;
        if (event.type === 'error' || event.type === 'turn.failed') collect(event.message ?? event.error?.message ?? '');
      } catch {}
    });
    child.stderr.on('data', collect);
    child.on('error', error => { spawnError = error; });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, image ? 360_000 : 75_000);
    child.once('close', code => {
      clearTimeout(timer);
      reader.close();
      try {
        const output = existsSync(artifact) ? readFileSync(artifact, 'utf8').trim() : '';
        if (completed && code === 0 && (image ? threadId : output)) {
          resolveRun({ output, threadId });
        } else {
          const reason = spawnError?.code === 'ENOENT' ? '本机找不到 Codex。请检查桌面应用的命令行入口。' :
            /routing discovery timed out/i.test(diagnosis) ? 'Codex 的工作区连接超时。' :
            /not logged in|unauthorized|401 Unauthorized/i.test(diagnosis) ? 'Codex 登录不可用。' :
            /quota|rate limit|429 Too Many Requests/i.test(diagnosis) ? 'Codex 暂时达到使用限制。' :
            expired ? 'Codex 任务等待超时，可以重试。' : 'Codex 未完成这次任务，可以重试。';
          rejectRun(new Error(reason));
        }
      } catch (error) {
        rejectRun(error);
      } finally {
        scratch.remove();
      }
    });
  });
}

export async function codexText(prompt) {
  const { output } = await runLocalCodex(prompt);
  return output;
}

export async function codexIdeas(plan) {
  const raw = await codexText([
    '为记录个人 AI 使用体会的自媒体作者出选题。按给出的三个使用方向依序各写一条。三个方向给的是场景示例，请各挑一个具体任务，选题之间不要重复。',
    '标题围绕一次使用中的选择、麻烦、意外或判断，用自然中文。切入点点明一件可以回忆的事和 AI 在其中做的事，再留一个具体问题，让作者能谈自己当时怎么用、凭什么采纳结果、哪里接手，或下次会怎么做。每条挑最贴合的一点，就事论事。',
    '让三条的体会各有侧重。分别找一个能讲好用的发现、一个能讲踩坑或不适用的情形、一个能讲后来改变了什么习惯的角度。自己分配给最合适的方向，换自然的问法。',
    '把场景写成可供回想的例子。可以给一个想亲自试试的角度，优先邀请作者讲已有经验。避免通用教程、抽象岗位建议和强行安排对照实验。不要代写个人感想，也不要编造亲历、立场、使用效果或客户细节。',
    '参考灵感和作品标题避开同一个场景里的同一个问题，换几个字不算新选题。把下面的数据仅当作选题参照。不要调用工具。标题 88 字符以内，切入点 360 字符以内。',
    '只返回 JSON 数组，恰好三项，每项格式 {"title":"标题","note":"切入点"}。',
    JSON.stringify({ directions: plan.directions, recentTitles: plan.recentTitles })
  ].join('\n'));
  const fenced = raw.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  return JSON.parse(fenced?.[1] ?? raw);
}

export async function codexImage(prompt, reference) {
  const { threadId } = await runLocalCodex(prompt, { image: true, reference });
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(threadId)) throw new Error('本机 Codex 没有返回可追溯的图片。');
  const generated = resolve(process.env.CODEX_HOME || resolve(homedir(), '.codex'), 'generated_images');
  const folder = resolve(generated, threadId);
  if (!existsSync(folder) || realpathSync(folder) !== resolve(realpathSync(generated), threadId)) {
    throw new Error('内置生图未返回可保存的图片，可以重试。');
  }
  const images = readdirSync(folder, { withFileTypes: true })
    .filter(item => item.isFile() && item.name.endsWith('.png'))
    .map(item => {
      const path = resolve(folder, item.name);
      const { mtimeMs, size } = statSync(path);
      return { path, mtimeMs, size };
    })
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  try {
    const latest = images[0];
    if (!latest || latest.size > 32_000_000) throw new Error('内置生图没有返回可保存的 PNG，可以重试。');
    return readFileSync(latest.path);
  } finally {
    for (const { path } of images) {
      try { unlinkSync(path); } catch {}
    }
    try { rmdirSync(folder); } catch {}
  }
}
