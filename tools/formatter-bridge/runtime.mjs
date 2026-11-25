import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { parseEnv } from 'node:util';

export const formatterRevision = '1fee8012339ebd7bd31decadbbaef20aadc7b48a';
export const formatterSource = resolve(process.env.ZHENYI_FORMATTER_SOURCE ?? join(homedir(), 'Documents/Trae/wechat_article_formatter_app'));
const adapter = dirname(fileURLToPath(import.meta.url));

export function formatterRuntime({ port = 5631, source = formatterSource } = {}) {
  const origin = 'http://127.0.0.1:' + port;
  let child;
  let starting;
  const stop = () => child?.kill('SIGTERM');
  const start = deskOrigin => {
    if (starting) return starting;
    starting = (async () => {
      const dependency = resolve(source, 'node_modules', 'next', 'dist', 'bin', 'next');
      if (!existsSync(dependency)) throw new Error('找不到原版排版工具的本机依赖。');
      const area = mkdtempDisposableSync(join(tmpdir(), 'zhenyi-formatter-studio-'));
      try {
        const archive = execFileSync('git', ['-C', source, 'archive', formatterRevision, 'app', 'components', 'lib', 'store', 'tests/fixtures',
          'next.config.ts', 'package.json', 'postcss.config.mjs', 'tailwind.config.ts', 'tsconfig.json'],
        { maxBuffer: 20_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
        execFileSync('tar', ['-xf', '-', '-C', area.path], { input: archive });
        symlinkSync(resolve(source, 'node_modules'), join(area.path, 'node_modules'), 'dir');
        const patch = (relative, before, after) => {
          const path = join(area.path, relative);
          const input = readFileSync(path, 'utf8');
          if (!input.includes(before)) throw new Error('原版排版器与联动入口不匹配。');
          writeFileSync(path, input.replace(before, after));
        };
        patch('components/studio/studio.tsx', 'import { useRef,', 'import { WorkbenchControls } from "./workbench-controls";\nimport { useRef,');
        patch('components/studio/studio.tsx', '<div className="studio-header-end">', '<div className="studio-header-end">\n' +
          '          <WorkbenchControls studio={s} enterEditor={() => setView("editor")} canSave={!candidate} />');
        patch('components/studio/studio.tsx', '账号未开通', '本机免登录');
        patch('components/studio/studio.tsx', '本站的统一账号登录尚未开通。当前稿件保存在此浏览器。', '当前稿件和编辑历史保存在此浏览器。');
        patch('next.config.ts', '  reactStrictMode: true,', '  reactStrictMode: true,\n  devIndicators: false,');
        appendFileSync(join(area.path, 'components/studio/studio.css'), `
.studio-workbench-bridge { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; }
.studio-workbench-bridge:empty { display: none; }
.studio-workbench-bridge [role="status"] { max-width: 260px; color: var(--s-night-text); font-size: 12px; line-height: 1.4; }
@media (max-width: 600px) {
  .studio-header-end:has(.studio-workbench-bridge:not(:empty)) { gap: 4px; }
  .studio-header-end:has(.studio-workbench-bridge:not(:empty)) .studio-save-state { display: none; }
  .studio-workbench-bridge .studio-btn { min-height: 38px; padding-inline: 7px; }
}
`);
        patch('components/studio/use-studio.ts', '    openArticle,\n', '    openArticle,\n    flushCurrent,\n');
        writeFileSync(join(area.path, 'components/studio/workbench-controls.tsx'), readFileSync(join(adapter, 'workbench-controls.tsx')));
        const route = join(area.path, 'app/api/workbench-desk/route.ts');
        mkdirSync(dirname(route), { recursive: true });
        writeFileSync(route, readFileSync(join(adapter, 'workbench-route.ts')));
        const settings = resolve(source, '.env.local');
        const providerEnv = existsSync(settings) ? Object.fromEntries(Object.entries(parseEnv(readFileSync(settings, 'utf8')))
          .filter(([name]) => name.startsWith('AI_'))) : {};
        child = spawn(process.execPath, [dependency, 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
          cwd: area.path,
          env: { ...providerEnv, ...process.env, ACCOUNT_MODE: 'local', NEXT_TELEMETRY_DISABLED: '1',
            ZHENYI_WORKBENCH_ORIGIN: deskOrigin, ZHENYI_FORMATTER_ORIGIN: origin },
          stdio: ['ignore', 'pipe', 'pipe']
        });
      } catch (error) {
        area.remove();
        throw error;
      }
      let diagnostic = '';
      const capture = chunk => { diagnostic = (diagnostic + chunk).slice(-3500); };
      child.stderr.on('data', capture);
      child.stdout.on('data', capture);
      const stdout = createInterface({ input: child.stdout });
      await new Promise((ready, reject) => {
        const timer = setTimeout(() => {
          stop();
          reject(new Error('启动原版排版工作区超时。'));
        }, 35_000);
        function done(error) {
          clearTimeout(timer);
          stdout.off('line', line);
          if (error) reject(error);
          else ready();
        }
        const line = value => { if (/Ready in|Ready in \d|✓ Ready/u.test(value)) done(); };
        stdout.on('line', line);
        child.once('error', () => done(new Error('无法启动原版排版工具。')));
        child.once('close', (code, signal) => {
          stdout.close();
          area.remove();
          child = starting = undefined;
          const occupied = diagnostic.includes('EADDRINUSE');
          done(new Error(occupied ? `公众号排版端口 ${port} 已被占用。` : `原版排版工作区未能启动（${signal || code}）。`));
        });
      });
      return origin;
    })().catch(error => { starting = undefined; throw error; });
    return starting;
  };
  return { start, stop };
}
