'use strict';

globalThis.WORKBENCH_DRAFT_EDITING = (() => {
  const draftActions = ['draft', 'revise', 'polish', 'manual'];
  const editorialStages = ['topic', 'listening', 'draft', 'final'];
  const articleLimit = 20_000;
  const douyinTitleLimit = 20;
  const douyinTagCount = 5;
  const douyinTitleLength = title => Array.from(title).length;

  function manuscriptProgress(state, topic) {
    const jobs = state.jobs.filter(job => job.entryId === topic.id);
    const done = jobs.filter(job => job.status === 'done');
    const draft = done.findLast(job => draftActions.includes(job.action));
    const outline = done.findLast(job => !job.action);
    const approval = state.finals.findLast(item => item.entryId === topic.id && !item.withdrawnAt);
    const final = done.find(job => job.id === approval?.jobId && draftActions.includes(job.action));
    const packages = done.filter(job => job.action === 'delivery' && job.delivery);
    const delivery = final && packages.findLast(job => job.revisionOf === final.id);
    const channels = Object.values(topic.channels ?? {});
    const delivered = packages.length > 0 || channels.some(channel => channel.packageFile);
    const published = state.checks.some(item => item.entryId === topic.id && item.state === 'published') ||
      channels.some(channel => channel.publication?.at && channel.publication.evidence);
    const locked = delivered || published;
    const rework = locked ? undefined : state.reworks?.find(item => item.entryId === topic.id)?.stage;
    const topicSelected = rework !== 'topic' && Boolean(outline || draft || topic.stage !== 'topic');
    const stage = final ? 'delivery' : rework ??
      (draft?.action === 'polish' ? 'final' : draft ? 'draft' : topicSelected ? 'listening' : 'topic');
    const running = jobs.some(job => job.status === 'running');
    return { jobs, draft, outline, approval, final, delivery, delivered, published, locked, rework, topicSelected, stage, running };
  }

  function canReturnTo(work, stage) {
    const target = editorialStages.indexOf(stage);
    return !work.locked && !work.running && target >= 0 &&
      (work.stage === 'delivery' || target < editorialStages.indexOf(work.stage));
  }

  function draftBlocks(body) {
    let offset = 0;
    return body.split(/(\r?\n(?:[^\S\r\n]*\r?\n)+)/u).flatMap(part => {
      const start = offset + part.length - part.trimStart().length;
      offset += part.length;
      const text = part.trim();
      return text ? [{ text, start, end: start + text.length }] : [];
    });
  }

  function draftWordCount(body) {
    const readable = body.replace(/!?\[([^\]\n]*)\]\([^)\n]+\)/gu, '$1').replace(/https?:\/\/[^\s<>]+/gu, '').normalize('NFC');
    return (readable.match(/\p{Script=Han}|\p{Script=Latin}+(?:[-'’]\p{Script=Latin}+)*|\p{Nd}+(?:[.,]\p{Nd}+)*/gu) ?? []).length;
  }

  function wechatLengthRange(material) {
    const count = draftWordCount(material);
    if (count >= 1100) return [1200, 1800];
    if (count >= 550) return [850, 1300];
    return [650, 1000];
  }

  function revisionPassage(body, paragraph, quote) {
    const selection = String(paragraph ?? '').trim();
    const needle = typeof quote === 'string' ? quote.trim() : '';
    if (selection && !/^\d+$/u.test(selection)) throw new Error('请选择当前稿件中的段落。');
    const block = selection ? draftBlocks(body)[Number(selection)] : null;
    if (selection && !block) throw new Error('找不到这一段，请重新选择。');
    if (!needle) {
      if (!block) throw new Error('请选择一段，或粘贴需要修改的原句。');
      return { start: block.start, end: block.end };
    }
    const area = block?.text ?? body;
    const found = area.indexOf(needle);
    if (found < 0) throw new Error('没在所选范围找到这句原文，请核对后重试。');
    if (area.indexOf(needle, found + 1) !== -1) throw new Error('这句原文出现了多次，请指定段落或粘贴更完整的原句。');
    const start = (block?.start ?? 0) + found;
    return { start, end: start + needle.length };
  }

  return { draftActions, articleLimit, manuscriptProgress, canReturnTo, draftBlocks, draftWordCount, wechatLengthRange, revisionPassage,
    douyinTitleLimit, douyinTagCount, douyinTitleLength };
})();
