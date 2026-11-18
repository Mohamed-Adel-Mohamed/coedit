import { z } from 'zod';
import { pickPresenceColor } from '@coedit/shared';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(200)
  .regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Enter a valid email address');

const password = z.string().min(10, 'Use at least 10 characters').max(200);

const displayName = z
  .string()
  .max(120)
  .transform((value) => sanitizeDisplayName(value, ''))

export const registerSchema = z.object({
  email,
  password,
  displayName,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(200),
});

export const createDocumentSchema = z.object({
  title: z
    .string()
    .max(200)
    .optional()
    .transform((value) => sanitizeTitle(value, 'Untitled document')),
});

export const updateDocumentSchema = z.object({
  title: z
    .string()
    .max(200)
    .transform((value, ctx) => {
      const title = sanitizeTitle(value, '');
      if (!title) {
        ctx.addIssue({ code: 'custom', message: 'Title cannot be empty' });
        return z.NEVER;
      }
      return title;
    }),
});

export const createShareSchema = z.object({
  role: z.enum(['viewer', 'commenter', 'editor']),
  label: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ?? '').trim().slice(0, 100)),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional(),
});

export const createCommentSchema = z.object({
  body: z.string().trim().min(1, 'Write a comment first').max(4000),
  guestName: z.string().max(120).optional(),
  anchorQuote: z.string().max(600).nullish(),
  anchorFrom: z.coerce.number().int().min(0).max(1_000_000).nullish(),
  anchorTo: z.coerce.number().int().min(0).max(1_000_000).nullish(),
});

export const updateCommentSchema = z.object({
  resolved: z.boolean(),
});

export const createSnapshotSchema = z.object({
  label: z
    .string()
    .max(100)
    .optional()
    .transform((value) => (value ?? '').trim().slice(0, 100)),
});

export const wsTicketSchema = z.object({
  guestName: z.string().max(120).optional(),
});

export function sanitizeDisplayName(raw: unknown, fallback = 'Guest'): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return cleaned || fallback;
}

export function sanitizeTitle(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
  return cleaned || fallback;
}

export function guestColor(seed: string): string {
  return pickPresenceColor(seed);
}
