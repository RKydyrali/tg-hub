import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenvFile } from "dotenv";
import { z } from "zod";
const sourceDir = dirname(fileURLToPath(import.meta.url));
const botRoot = resolve(sourceDir, "..");
const repoRoot = resolve(botRoot, "../..");
function loadEnvFiles() {
    for (const file of [
        resolve(botRoot, ".env.local"),
        resolve(botRoot, ".env"),
        resolve(repoRoot, ".env.local"),
        resolve(repoRoot, ".env"),
    ]) {
        if (existsSync(file)) {
            loadDotenvFile({ path: file, quiet: true });
        }
    }
}
const envSchema = z.object({
    TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
    CONVEX_SITE_URL: z
        .string()
        .min(1, "CONVEX_SITE_URL is required")
        .transform((s) => s.trim().replace(/\/+$/, "")),
    BOT_SHARED_SECRET: z.string().min(1, "BOT_SHARED_SECRET is required"),
});
export function loadEnv() {
    loadEnvFiles();
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
        throw new Error(`Invalid environment: ${msg}`);
    }
    return parsed.data;
}
export function logStartupBanner(env) {
    let convexHost = env.CONVEX_SITE_URL;
    try {
        convexHost = new URL(env.CONVEX_SITE_URL).host;
    }
    catch {
        /* keep raw */
    }
    console.log(JSON.stringify({
        event: "telegram_bot_start",
        convexHost,
        hasBotToken: Boolean(env.TELEGRAM_BOT_TOKEN),
        hasSharedSecret: Boolean(env.BOT_SHARED_SECRET),
        mode: "long_polling",
    }));
}
