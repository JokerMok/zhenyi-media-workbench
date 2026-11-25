"use client";
import { useEffect, useRef, useState } from "react";
import { escapeMarkup } from "@/lib/content/markdown";
import { parseArticle } from "@/lib/studio/import";
import { checkImages, splitWechatArticle, wechatHTML } from "@/lib/studio/renderer";
import { studioDB } from "@/lib/studio/storage";
import { builtInStyles } from "@/lib/studio/styles";
import type { ArticleDocument, StyleTokens } from "@/lib/studio/types";
import { seedLayout } from "./use-article-layout";
import type { useStudio } from "./use-studio";

type Studio = ReturnType<typeof useStudio>;
type Source = {
  deliveryId: string;
  title: string;
  article: string;
  layout?: { styleId?: string; theme?: StyleTokens; articleId?: string } | null;
  returnUrl: string;
};

export function WorkbenchControls({ studio, enterEditor, canSave }: {
  studio: Studio;
  enterEditor: () => void;
  canSave: boolean;
}) {
  const [ticket, setTicket] = useState("");
  const [bound, setBound] = useState<{ id: string; returnUrl: string }>();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const started = useRef(false);
  const latest = useRef({ studio, enterEditor });
  latest.current = { studio, enterEditor };
  useEffect(() => setTicket(new URLSearchParams(window.location.search).get("workbench") ?? ""), []);

  useEffect(() => {
    if (!ticket || !studio.article || started.current) return;
    started.current = true;
    setMessage("正在载入作品台定稿…");
    void (async () => {
      const response = await fetch("/api/workbench-desk?ticket=" + encodeURIComponent(ticket));
      const source = await response.json() as Source & { error?: string };
      if (!response.ok) throw new Error(source.error ?? "载入作品台定稿失败。");
      const id = source.layout?.articleId ?? "workbench-" + source.deliveryId;
      const db = studioDB();
      let article = await db.articles.get(id);
      if (article?.deletedAt) throw new Error("这份稿件在回收站，请先在「我的工作台」恢复它。");
      if (!article) {
        const profile = builtInStyles.find(item => item.id === source.layout?.styleId) ?? builtInStyles[0];
        const initial: ArticleDocument = {
          id, name: source.title,
          blocks: [
            { id: id + "-title", kind: "title", html: escapeMarkup(source.title) },
            ...parseArticle(source.article, "markdown"),
          ],
          styleId: profile.id,
          styleVersion: profile.version,
          ...(source.layout?.theme ? { theme: source.layout.theme } : {}),
          updatedAt: new Date().toISOString(),
        };
        article = { ...initial, layout: seedLayout(initial, profile) };
        await db.articles.put(article);
        await latest.current.studio.refresh();
      }
      await latest.current.studio.openArticle(article.id);
      latest.current.enterEditor();
      setBound({ id, returnUrl: source.returnUrl });
      setMessage("");
    })().catch(error => setMessage(error instanceof Error ? error.message : "载入作品失败。"));
  }, [ticket, Boolean(studio.article)]);

  if (!ticket) return null;
  const returnToDesk = async () => {
    if (!bound || studio.article?.id !== bound.id || !canSave) return;
    setSaving(true);
    setMessage("");
    try {
      await studio.flushCurrent();
      const { title, body } = splitWechatArticle(studio.article);
      await checkImages(body, studio.assets);
      const html = body.blocks.length ? wechatHTML(body, studio.profile, studio.assets).html : "";
      const response = await fetch("/api/workbench-desk", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticket, articleId: bound.id, styleName: studio.profile.name, title, bodyHtml: html }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "工作台未能保存排版。");
      window.location.replace(bound.returnUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "保存排版失败。");
      setSaving(false);
    }
  };
  return <div className="studio-workbench-bridge">
    {message && <span role="status">{message}</span>}
    {bound && <button type="button" className="studio-btn primary"
      disabled={saving || studio.article?.id !== bound.id || !canSave}
      title={studio.article?.id !== bound.id ? "请打开从作品台载入的稿件" : !canSave ? "请先确认应用当前风格" : undefined}
      onClick={() => void returnToDesk()}>
      {saving ? "正在保存…" : "保存并返回作品台"}
    </button>}
  </div>;
}
