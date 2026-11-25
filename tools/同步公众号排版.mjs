import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatterRevision, formatterSource } from './formatter-bridge/runtime.mjs';

const source = resolve(process.argv[2] || formatterSource);
const { build } = createRequire(join(source, 'package.json'))('esbuild');
const archive = execFileSync('git', ['-C', source, 'archive', formatterRevision,
  'lib/content', 'lib/studio', 'lib/copy-rich-text.ts']);
const temporary = mkdtempDisposableSync(join(tmpdir(), 'zhenyi-wechat-'));
const modulePath = new URL('../workbench/排版引擎.mjs', import.meta.url);

try {
  execFileSync('tar', ['-xf', '-', '-C', temporary.path], { input: archive });
  const bundle = await build({
    stdin: {
      resolveDir: temporary.path,
      loader: 'ts',
      contents: `
import { escapeMarkup } from "./lib/content/markdown";
import { createArticleLayout, layoutRequest } from "./lib/studio/article-layout";
import { defaultLayoutSettings } from "./lib/studio/layout-contract";
import { parseArticle } from "./lib/studio/import";
import { splitWechatArticle, wechatHTML } from "./lib/studio/renderer";
import { builtInStyles } from "./lib/studio/styles";
import type { ArticleDocument, StyleTokens } from "./lib/studio/types";

export { builtInStyles };
export { copyPlainText, copyRichText } from "./lib/copy-rich-text";
export { downloadBlob } from "./lib/studio/renderer";

export function formatWechat(title: string, markdown: string, styleId: string, theme: StyleTokens) {
  const profile = builtInStyles.find(style => style.id === styleId);
  if (!profile) throw new Error("找不到这套排版风格。");
  const warnings: string[] = [];
  const article: ArticleDocument = {
    id: "workbench",
    name: title,
    blocks: [
      { id: "workbench-title", kind: "title", html: escapeMarkup(title) },
      ...parseArticle(markdown, "markdown", document, warnings),
    ],
    styleId,
    styleVersion: profile.version,
    theme,
    updatedAt: "",
  };
  const settings = defaultLayoutSettings;
  article.layout = {
    ...createArticleLayout(layoutRequest(article, settings, profile)),
    settings,
    automatic: true,
    enabled: true,
  };
  const { title: exportTitle, body } = splitWechatArticle(article);
  const rendered = body.blocks.length ? wechatHTML(body, profile, {}) : { html: "", warnings: [] };
  return { title: exportTitle, html: rendered.html, warnings: [...new Set([...warnings, ...rendered.warnings])] };
}
`
    },
    nodePaths: [join(source, 'node_modules')],
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
    legalComments: 'eof', metafile: true, write: false
  });
  const licenses = new Map();
  for (const input of Object.keys(bundle.metafile.inputs)) {
    const packagePath = input.split('/node_modules/').at(-1);
    if (packagePath === input) continue;
    const name = packagePath.split('/').slice(0, packagePath.startsWith('@') ? 2 : 1).join('/');
    if (licenses.has(name)) continue;
    const directory = join(source, 'node_modules', name);
    const license = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'license'].find(file => existsSync(join(directory, file)));
    if (license) licenses.set(name, readFileSync(join(directory, license), 'utf8').trim());
  }
  const notices = [...licenses].map(([name, license]) => name + '\n' + license).join('\n\n').replaceAll('*/', '* /');
  const header = '/* Built from JokerMok/wechat_article_formatter_app@' + formatterRevision +
    '. Rebuild with tools/同步公众号排版.mjs.\n\n' + notices + '\n*/\n';
  writeFileSync(modulePath, header + bundle.outputFiles[0].text);
  console.log(fileURLToPath(modulePath));
} finally {
  temporary.remove();
}
