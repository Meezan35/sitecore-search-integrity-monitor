import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const envSchema = z.object({
  SITECORE_SEARCH_API_KEY: z
    .string()
    .min(1, "SITECORE_SEARCH_API_KEY is required")
    .refine(
      (value) => !/^https?:\/\//i.test(value.trim()),
      "SITECORE_SEARCH_API_KEY must be the Bearer API key (e.g. 01-...), not the Discover apiUrl",
    )
    .refine(
      (value) => !/^\d+$/.test(value.trim()),
      "SITECORE_SEARCH_API_KEY must not be only digits — that value is the account ID in the Discover URL path (/discover/v2/...), not the API key. Copy the full key from Sitecore Discover (usually starts with 01-).",
    ),
  OUTPUT_DIR: z.string().min(1).default("./output"),
});

export type AppEnv = z.infer<typeof envSchema>;

export function loadEnv(): AppEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${details}`);
  }

  return result.data;
}
