import { z } from "zod";

export class ConvexBotHttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: unknown,
  ) {
    super(`Convex HTTP ${status}`);
    this.name = "ConvexBotHttpError";
  }
}

const userDocSchema = z.object({}).passthrough();

const upsertUserResponseSchema = z.object({
  user: userDocSchema,
});

const vacancySchema = z
  .object({
    _id: z.string(),
    title: z.string(),
    description: z.string().optional(),
    source: z.enum(["native", "hh"]),
    city: z.string(),
    status: z.string(),
    salaryMin: z.number().optional(),
    salaryMax: z.number().optional(),
    salaryCurrency: z.string().optional(),
    externalApplyUrl: z.string().optional(),
    screeningQuestions: z.array(z.string()).optional(),
  })
  .passthrough();

const listVacanciesResponseSchema = z.object({
  vacancies: z.array(vacancySchema),
});

const applicationResponseSchema = z.object({
  application: z.object({}).passthrough(),
});

const linkTelegramResponseSchema = z.object({
  user: userDocSchema,
});

const botApplicationRowSchema = z.object({
  application: z.object({
    _id: z.string(),
    status: z.string(),
  }).passthrough(),
  vacancy: z
    .object({
      title: z.string(),
      city: z.string().optional(),
    })
    .passthrough()
    .nullable(),
});

const listApplicationsResponseSchema = z.object({
  applications: z.array(botApplicationRowSchema),
});

const botNotificationSchema = z.object({
  _id: z.string(),
  title: z.string(),
  body: z.string(),
  readAt: z.number().optional(),
}).passthrough();

const listNotificationsResponseSchema = z.object({
  notifications: z.array(botNotificationSchema),
});

const errorBodySchema = z.object({
  error: z.string(),
  issues: z.array(z.unknown()).optional(),
});

const notificationPrefsRowSchema = z.object({
  userId: z.string(),
  isBotLinked: z.boolean(),
  telegramUsername: z.string().optional(),
  preferences: z.object({
    inApp: z.boolean(),
    telegram: z.boolean(),
    newApplications: z.boolean(),
    statusChanges: z.boolean(),
    interviews: z.boolean(),
    aiRecommendations: z.boolean(),
  }),
});

const patchPrefsResponseSchema = z.object({
  user: userDocSchema,
  preferences: notificationPrefsRowSchema.shape.preferences,
});

export type BotVacancy = z.infer<typeof vacancySchema>;
export type BotApplicationRow = z.infer<typeof botApplicationRowSchema>;
export type BotNotification = z.infer<typeof botNotificationSchema>;
export type NotificationPreferences = z.infer<
  typeof notificationPrefsRowSchema
>["preferences"];

export class ConvexBotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly secret: string,
  ) {}

  private async postJson<T>(path: string, body: unknown, parse: (j: unknown) => T): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": this.secret,
      },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ConvexBotHttpError(res.status, json);
    }
    return parse(json);
  }

  private async get<T>(path: string, parse: (j: unknown) => T): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-bot-secret": this.secret },
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ConvexBotHttpError(res.status, json);
    }
    return parse(json);
  }

  private async patchJson<T>(path: string, body: unknown, parse: (j: unknown) => T): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-bot-secret": this.secret,
      },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new ConvexBotHttpError(res.status, json);
    }
    return parse(json);
  }

  async upsertUser(input: {
    telegramChatId: string;
    telegramUsername?: string;
    role?: "seeker" | "employer";
  }): Promise<z.infer<typeof userDocSchema>> {
    const data = await this.postJson("/users/upsert", input, (j) =>
      upsertUserResponseSchema.parse(j),
    );
    return data.user;
  }

  async linkTelegram(input: {
    token: string;
    telegramChatId: string;
    telegramUsername?: string;
  }): Promise<z.infer<typeof userDocSchema>> {
    const data = await this.postJson("/users/link-telegram", input, (j) =>
      linkTelegramResponseSchema.parse(j),
    );
    return data.user;
  }

  async listVacancies(params: {
    region?: "aktau";
    source?: "native" | "hh";
    city?: string;
    limit?: number;
  }): Promise<BotVacancy[]> {
    const sp = new URLSearchParams();
    if (params.region) sp.set("region", params.region);
    if (params.source) sp.set("source", params.source);
    if (params.city) sp.set("city", params.city);
    if (params.limit !== undefined) sp.set("limit", String(params.limit));
    const q = sp.toString();
    const path = q ? `/vacancies?${q}` : "/vacancies";
    const data = await this.get(path, (j) => listVacanciesResponseSchema.parse(j));
    return data.vacancies;
  }

  async submitApplication(input: {
    telegramChatId: string;
    vacancyId: string;
    screeningAnswers?: Array<{ question: string; answer: string }>;
  }): Promise<unknown> {
    const data = await this.postJson("/applications", input, (j) =>
      applicationResponseSchema.parse(j),
    );
    return data.application;
  }

  async listApplications(telegramChatId: string): Promise<BotApplicationRow[]> {
    const path = `/applications?telegramChatId=${encodeURIComponent(telegramChatId)}`;
    const data = await this.get(path, (j) => listApplicationsResponseSchema.parse(j));
    return data.applications;
  }

  async listNotifications(telegramChatId: string): Promise<BotNotification[]> {
    const path = `/notifications?telegramChatId=${encodeURIComponent(telegramChatId)}`;
    const data = await this.get(path, (j) => listNotificationsResponseSchema.parse(j));
    return data.notifications;
  }

  async getNotificationPreferences(telegramChatId: string): Promise<
    z.infer<typeof notificationPrefsRowSchema>
  > {
    const path = `/users/notification-preferences?telegramChatId=${encodeURIComponent(telegramChatId)}`;
    return this.get(path, (j) => notificationPrefsRowSchema.parse(j));
  }

  async patchNotificationPreferences(input: {
    telegramChatId: string;
  } & Partial<NotificationPreferences>): Promise<z.infer<typeof patchPrefsResponseSchema>> {
    return this.patchJson("/users/notification-preferences", input, (j) =>
      patchPrefsResponseSchema.parse(j),
    );
  }
}

export function formatConvexErrorMessage(err: unknown): string {
  if (err instanceof ConvexBotHttpError) {
    const parsed = errorBodySchema.safeParse(err.body);
    if (parsed.success) {
      return parsed.data.error;
    }
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Неизвестная ошибка";
}

