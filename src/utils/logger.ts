type LogLevel = 'info' | 'warn' | 'error' | 'debug';

function formatTimestamp(): string {
  return new Date().toISOString();
}

function log(level: LogLevel, message: string, meta?: Record<string, unknown> | Error | unknown) {
  const timestamp = formatTimestamp();
  const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

  if (meta instanceof Error) {
    console.error(`${prefix} ${message}:`, meta.stack || meta.message);
  } else if (meta !== undefined) {
    if (level === 'error') {
      console.error(`${prefix} ${message}`, JSON.stringify(meta));
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}`, JSON.stringify(meta));
    } else {
      console.log(`${prefix} ${message}`, JSON.stringify(meta));
    }
  } else {
    if (level === 'error') {
      console.error(`${prefix} ${message}`);
    } else if (level === 'warn') {
      console.warn(`${prefix} ${message}`);
    } else {
      console.log(`${prefix} ${message}`);
    }
  }
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown> | Error | unknown) => log('error', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => {
    if (process.env.NODE_ENV !== 'production') {
      log('debug', msg, meta);
    }
  },
};
