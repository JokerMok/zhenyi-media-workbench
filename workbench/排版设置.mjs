export const fontOptions = [['sans', '无衬线'], ['serif', '宋体风格']];
export const numberFields = [
  { name: 'bodySize', label: '正文字号', min: 12, max: 24, unit: 'px' },
  { name: 'titleSize', label: '主标题字号', min: 20, max: 48, unit: 'px' },
  { name: 'headingSize', label: '章节标题字号', min: 16, max: 36, unit: 'px' },
  { name: 'lineHeight', label: '行距', min: 1.2, max: 2.8, step: .05, unit: '倍' },
  { name: 'paragraphGap', label: '段落间距', min: 4, max: 48, unit: 'px' },
  { name: 'padding', label: '正文边距', min: 0, max: 80, unit: 'px' },
  { name: 'radius', label: '图片圆角', min: 0, max: 32, unit: 'px' }
];
export const colorFields = [['accent', '强调色'], ['text', '正文颜色'], ['background', '底色'], ['muted', '辅助色']];
const styleIds = ['builtin-forest', 'builtin-ink', 'builtin-blue'];

export function validateWechatLayout(input) {
  if (!styleIds.includes(input?.styleId)) throw new Error('请选择一套可用风格。');
  const theme = {};
  for (const { name, label, min, max } of numberFields) {
    const value = input.theme?.[name];
    if (!Number.isFinite(value) || value < min || value > max) throw new Error(label + '需在 ' + min + '–' + max + ' 之间。');
    theme[name] = value;
  }
  for (const [name, label] of colorFields) {
    const value = input.theme?.[name];
    if (typeof value !== 'string' || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(label + '格式不正确。');
    theme[name] = value;
  }
  if (!fontOptions.some(([key]) => key === input.theme?.fontFamily)) throw new Error('请选择可用的正文字体。');
  theme.fontFamily = input.theme.fontFamily;
  return { styleId: input.styleId, theme };
}
