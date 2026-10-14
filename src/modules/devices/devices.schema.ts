import { z } from 'zod';

export const registerDeviceSchema = z.object({
  deviceId: z
    .string()
    .trim()
    .min(3, 'Device ID must be at least 3 characters')
    .max(50, 'Device ID must not exceed 50 characters')
    .regex(/^[a-zA-Z0-9_-]+$/, 'Device ID can only contain letters, numbers, underscores, and hyphens')
    .transform((val) => val.toUpperCase()),
  name: z.string().trim().min(1, 'Device name is required').max(100),
});

export const updateDeviceSchema = z.object({
  name: z.string().trim().min(1, 'Device name cannot be empty').max(100).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
