import { loadEnv, logStartupBanner } from "./env.js";
import { createBot } from "./bot.js";

async function main(): Promise<void> {
  const env = loadEnv();
  logStartupBanner(env);
  const bot = createBot(
    env.TELEGRAM_BOT_TOKEN,
    `${env.CONVEX_SITE_URL}/v1/bot`,
    env.BOT_SHARED_SECRET,
  );
  await bot.api.setMyCommands([
    { command: "start", description: "Подключить или проверить аккаунт" },
    { command: "settings", description: "Настройки уведомлений" },
  ]);
  console.log(JSON.stringify({ event: "telegram_bot_polling_start" }));
  await bot.start();
}

main().catch((err) => {
  console.error(JSON.stringify({ event: "telegram_bot_fatal", error: String(err) }));
  process.exit(1);
});

