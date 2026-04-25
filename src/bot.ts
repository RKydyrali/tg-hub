import { Bot, Context, InlineKeyboard, Keyboard } from "grammy";

import {
  ConvexBotClient,
  ConvexBotHttpError,
  formatConvexErrorMessage,
  type BotApplicationRow,
  type BotNotification,
  type BotVacancy,
  type NotificationPreferences,
} from "./convexBotClient.js";

const PAGE = 5;

type ApplyDraft = {
  vacancyId: string;
  questions: string[];
  answers: Array<{ question: string; answer: string }>;
  step: number;
};

const applyDrafts = new Map<string, ApplyDraft>();

export function linkedMenuLabels(): string[] {
  return ["Вакансии", "Мои отклики", "Уведомления", "Настройки"];
}

export function unlinkedMenuLabels(): string[] {
  return ["Подключить Telegram"];
}

export function parseStartPayload(text: string | undefined): string | null {
  const match = text?.trim().match(/^\/start(?:@\w+)?(?:\s+(.+))?$/);
  const payload = match?.[1]?.trim();
  return payload || null;
}

export function menuActionFromText(
  text: string,
): { type: "jobs" | "applications" | "notifications" | "settings" } | null {
  if (text === "Вакансии") return { type: "jobs" };
  if (text === "Мои отклики") return { type: "applications" };
  if (text === "Уведомления") return { type: "notifications" };
  if (text === "Настройки") return { type: "settings" };
  return null;
}

function linkedMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text("Вакансии")
    .text("Мои отклики")
    .row()
    .text("Уведомления")
    .text("Настройки")
    .resized();
}

function unlinkedMenuKeyboard(): Keyboard {
  return new Keyboard().text("Подключить Telegram").resized();
}

function jobsMenuKeyboard(): Keyboard {
  return new Keyboard()
    .text("Вакансии Актау (все)")
    .row()
    .text("Только на платформе")
    .text("Только с HH")
    .row()
    .text("Настройки")
    .resized();
}

function sourceFromMenuKey(
  key: string,
): { region: "aktau"; source?: "native" | "hh" } | null {
  if (key === "Вакансии Актау (все)") return { region: "aktau" };
  if (key === "Только на платформе") return { region: "aktau", source: "native" };
  if (key === "Только с HH") return { region: "aktau", source: "hh" };
  return null;
}

function salaryLine(v: BotVacancy): string {
  if (v.salaryMin != null || v.salaryMax != null) {
    const cur = v.salaryCurrency ? ` ${v.salaryCurrency}` : "";
    if (v.salaryMin != null && v.salaryMax != null) {
      return `${v.salaryMin}–${v.salaryMax}${cur}`;
    }
    if (v.salaryMin != null) return `от ${v.salaryMin}${cur}`;
    return `до ${v.salaryMax}${cur}`;
  }
  return "Зарплата не указана";
}

function vacancyCard(v: BotVacancy): string {
  const src = v.source === "native" ? "На платформе" : "HH";
  return `«${v.title}»\n${src} · ${v.city}\n${salaryLine(v)}`;
}

async function sendVacancyList(
  ctx: Context,
  client: ConvexBotClient,
  params: { region: "aktau"; source?: "native" | "hh" },
  offset: number,
): Promise<void> {
  await ctx.replyWithChatAction("typing");
  const all = await client.listVacancies({ ...params, limit: 50 });
  const slice = all.slice(offset, offset + PAGE);
  if (slice.length === 0) {
    await ctx.reply("Подходящих вакансий сейчас нет. Загляните позже.");
    return;
  }
  const srcTag = params.source === "native" ? "n" : params.source === "hh" ? "h" : "a";
  let kb = new InlineKeyboard();
  for (const v of slice) {
    kb = kb.text(v.title.slice(0, 28), `d:${v._id}`).row();
  }
  if (offset + PAGE < all.length) {
    kb = kb.text("Ещё…", `l:${srcTag}:${offset + PAGE}`);
  }
  const header =
    params.source === "native"
      ? "Вакансии на платформе:"
      : params.source === "hh"
        ? "Вакансии с HH:"
        : "Вакансии Актау:";
  await ctx.reply(`${header}\n\nВыберите вакансию:`, { reply_markup: kb });
}

async function sendVacancyDetail(
  ctx: Context,
  client: ConvexBotClient,
  vacancyId: string,
): Promise<void> {
  await ctx.replyWithChatAction("typing");
  const list = await client.listVacancies({ region: "aktau", limit: 50 });
  const v = list.find((row) => row._id === vacancyId);
  if (!v) {
    await ctx.reply("Вакансия не найдена. Попробуйте открыть список заново.");
    return;
  }
  const kb = new InlineKeyboard().text("Откликнуться", `a:${v._id}`).row();
  if (v.externalApplyUrl) {
    kb.url("Открыть ссылку", v.externalApplyUrl);
  }
  await ctx.reply(`${vacancyCard(v)}\n\n${(v.description ?? "").slice(0, 900)}`, {
    reply_markup: kb,
  });
}

function draftKey(ctx: Context): string {
  return String(ctx.chat?.id ?? "");
}

function startApplyDraft(v: BotVacancy): ApplyDraft {
  return {
    vacancyId: v._id,
    questions: v.screeningQuestions ?? [],
    answers: [],
    step: 0,
  };
}

async function sendApplyStep(ctx: Context, draft: ApplyDraft): Promise<void> {
  if (!draft.questions.length) {
    await ctx.reply("Готово. Отправляю отклик…");
    return;
  }
  const q = draft.questions[draft.step];
  await ctx.reply(`Вопрос ${draft.step + 1}/${draft.questions.length}:\n${q}`);
}

async function finishApply(
  ctx: Context,
  client: ConvexBotClient,
  chatId: string,
  draft: ApplyDraft,
): Promise<void> {
  await ctx.replyWithChatAction("typing");
  await client.submitApplication({
    telegramChatId: chatId,
    vacancyId: draft.vacancyId,
    screeningAnswers: draft.answers,
  });
  applyDrafts.delete(chatId);
  await ctx.reply("Отклик отправлен. Спасибо!", { reply_markup: linkedMenuKeyboard() });
}

function preferenceLabel(key: keyof NotificationPreferences): string {
  if (key === "telegram") return "Уведомления в Telegram";
  if (key === "inApp") return "Уведомления в приложении";
  if (key === "newApplications") return "Новые отклики";
  if (key === "statusChanges") return "Изменение статуса";
  if (key === "interviews") return "Интервью";
  return "AI-рекомендации";
}

function prefKeyboard(row: { preferences: NotificationPreferences }): InlineKeyboard {
  const p = row.preferences;
  const keys: Array<keyof NotificationPreferences> = [
    "telegram",
    "inApp",
    "newApplications",
    "statusChanges",
    "interviews",
    "aiRecommendations",
  ];
  let kb = new InlineKeyboard();
  for (const key of keys) {
    const on = Boolean(p[key]);
    kb = kb.text(`${on ? "✅" : "⬜"} ${preferenceLabel(key)}`, `p:${key}`).row();
  }
  return kb;
}

async function sendSettings(ctx: Context, client: ConvexBotClient, chatId: string): Promise<void> {
  await ctx.replyWithChatAction("typing");
  const row = await client.getNotificationPreferences(chatId);
  await ctx.reply("Настройки уведомлений:", { reply_markup: prefKeyboard(row) });
}

async function sendApplications(ctx: Context, client: ConvexBotClient, chatId: string): Promise<void> {
  await ctx.replyWithChatAction("typing");
  const rows: BotApplicationRow[] = await client.listApplications(chatId);
  if (!rows.length) {
    await ctx.reply("Откликов пока нет.");
    return;
  }
  const lines = rows.slice(0, 10).map((r) => {
    const title = r.vacancy?.title ?? "Вакансия";
    return `• ${title} — ${r.application.status}`;
  });
  await ctx.reply(["Ваши отклики:", ...lines].join("\n"));
}

async function sendNotifications(ctx: Context, client: ConvexBotClient, chatId: string): Promise<void> {
  await ctx.replyWithChatAction("typing");
  const rows: BotNotification[] = await client.listNotifications(chatId);
  if (!rows.length) {
    await ctx.reply("Уведомлений пока нет.");
    return;
  }
  const lines = rows.slice(0, 8).map((n) => `• ${n.title}\n${n.body}`);
  await ctx.reply(lines.join("\n\n"));
}

export function createBot(
  token: string,
  convexBaseUrl: string,
  sharedSecret: string,
): Bot<Context> {
  const bot = new Bot<Context>(token);
  const client = new ConvexBotClient(convexBaseUrl, sharedSecret);

  bot.catch(async (err: any) => {
    const ctx = err.ctx as Context;
    const e = err.error as unknown;
    console.error(JSON.stringify({ event: "telegram_bot_error", error: String(e) }));
    await ctx.reply(formatConvexErrorMessage(e));
  });

  bot.command("start", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    const payload = parseStartPayload(ctx.message?.text);
    await ctx.replyWithChatAction("typing");
    try {
      if (payload) {
        await client.linkTelegram({
          token: payload,
          telegramChatId: chatId,
          telegramUsername: ctx.from?.username,
        });
        await ctx.reply("Telegram подключён. Выберите действие:", {
          reply_markup: linkedMenuKeyboard(),
        });
        return;
      }
      await client.upsertUser({
        telegramChatId: chatId,
        telegramUsername: ctx.from?.username,
      });
      await ctx.reply("Привет! Чтобы подключить аккаунт, откройте настройки в JumysAI и нажмите «Подключить Telegram».", {
        reply_markup: unlinkedMenuKeyboard(),
      });
    } catch (e) {
      if (e instanceof ConvexBotHttpError) {
        await ctx.reply(formatConvexErrorMessage(e));
        return;
      }
      throw e;
    }
  });

  bot.command("settings", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    await sendSettings(ctx, client, chatId);
  });

  bot.on("message:text", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    const text = ctx.message.text.trim();

    const draft = applyDrafts.get(chatId);
    if (draft) {
      const question = draft.questions[draft.step];
      draft.answers.push({ question, answer: text });
      draft.step += 1;
      if (draft.step >= draft.questions.length) {
        await finishApply(ctx, client, chatId, draft);
      } else {
        await sendApplyStep(ctx, draft);
      }
      return;
    }

    const action = menuActionFromText(text);
    if (action?.type === "settings") {
      await sendSettings(ctx, client, chatId);
      return;
    }
    if (action?.type === "applications") {
      await sendApplications(ctx, client, chatId);
      return;
    }
    if (action?.type === "notifications") {
      await sendNotifications(ctx, client, chatId);
      return;
    }
    if (action?.type === "jobs") {
      await ctx.reply("Выберите источник:", { reply_markup: jobsMenuKeyboard() });
      return;
    }
    const src = sourceFromMenuKey(text);
    if (src) {
      await sendVacancyList(ctx, client, src, 0);
      return;
    }

    if (text === "Подключить Telegram") {
      await ctx.reply("Откройте JumysAI → Настройки → Подключить Telegram. Затем вернитесь сюда и нажмите /start с кодом.");
      return;
    }

    await ctx.reply("Выберите действие из меню.", {
      reply_markup: linkedMenuKeyboard(),
    });
  });

  bot.on("callback_query:data", async (ctx) => {
    const chatId = String(ctx.chat?.id ?? "");
    const data = ctx.callbackQuery.data;
    await ctx.answerCallbackQuery();

    if (data.startsWith("l:")) {
      const [, srcTag, offsetStr] = data.split(":");
      const offset = Number(offsetStr ?? "0");
      const params =
        srcTag === "n"
          ? { region: "aktau" as const, source: "native" as const }
          : srcTag === "h"
            ? { region: "aktau" as const, source: "hh" as const }
            : { region: "aktau" as const };
      await sendVacancyList(ctx, client, params, Number.isFinite(offset) ? offset : 0);
      return;
    }

    if (data.startsWith("d:")) {
      const vacancyId = data.slice(2);
      await sendVacancyDetail(ctx, client, vacancyId);
      return;
    }

    if (data.startsWith("a:")) {
      const vacancyId = data.slice(2);
      const list = await client.listVacancies({ region: "aktau", limit: 50 });
      const v = list.find((row) => row._id === vacancyId);
      if (!v) {
        await ctx.reply("Вакансия не найдена.");
        return;
      }
      const draft = startApplyDraft(v);
      applyDrafts.set(chatId, draft);
      if (!draft.questions.length) {
        await finishApply(ctx, client, chatId, draft);
        return;
      }
      await sendApplyStep(ctx, draft);
      return;
    }

    if (data.startsWith("p:")) {
      const key = data.slice(2) as keyof NotificationPreferences;
      const row = await client.getNotificationPreferences(chatId);
      const current = Boolean(row.preferences[key]);
      const next = !current;
      await client.patchNotificationPreferences({ telegramChatId: chatId, [key]: next });
      const updated = await client.getNotificationPreferences(chatId);
      await ctx.reply("Настройки обновлены:", { reply_markup: prefKeyboard(updated) });
      return;
    }
  });

  return bot;
}

