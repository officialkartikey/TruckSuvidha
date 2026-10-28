import dotenv from 'dotenv';
import { z } from 'zod';

// Load .env file
dotenv.config();

const envSchema = z.object({
  PORT: z.string().default('4000').transform((val) => parseInt(val, 10)),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  MONGODB_URI: z.string().default('mongodb://localhost:27017/trucksuvidha_gps'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters long'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('*'),
  DEVICE_OFFLINE_TIMEOUT_SECONDS: z.string().default('120').transform((val) => parseInt(val, 10)),
  RATE_LIMIT_WINDOW_MS: z.string().default('60000').transform((val) => parseInt(val, 10)),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('100').transform((val) => parseInt(val, 10)),
  DEVICE_RATE_LIMIT_MAX_REQUESTS: z.string().default('600').transform((val) => parseInt(val, 10)),
  TRUST_PROXY: z
    .string()
    .default('1')
    .transform((val) => {
      if (/^\d+$/.test(val)) {
        return parseInt(val, 10);
      }
      if (val.toLowerCase() === 'true') return true;
      if (val.toLowerCase() === 'false') return false;
      return val;
    }),
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment variables:', parsedEnv.error.format());
  process.exit(1);
}

export const env = parsedEnv.data;
