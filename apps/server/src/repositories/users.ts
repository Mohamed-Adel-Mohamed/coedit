import type { UserDto } from '@coedit/shared';
import type { Db } from '../db.js';

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  color: string;
  created_at: Date;
}

const COLUMNS = 'id, email, password_hash, display_name, color, created_at';

export async function createUser(
  pool: Db,
  input: {
    email: string;
    passwordHash: string;
    displayName: string;
    color: string;
  },
): Promise<UserRow> {
  const result = await pool.query<UserRow>(
    `INSERT INTO users (email, password_hash, display_name, color)
     VALUES ($1, $2, $3, $4)
     RETURNING ${COLUMNS}`,
    [input.email, input.passwordHash, input.displayName, input.color],
  );
  return result.rows[0]!;
}

export async function findUserByEmail(pool: Db, email: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `SELECT ${COLUMNS} FROM users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  return result.rows[0] ?? null;
}

export async function findUserById(pool: Db, id: string): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(`SELECT ${COLUMNS} FROM users WHERE id = $1 LIMIT 1`, [
    id,
  ]);
  return result.rows[0] ?? null;
}

export function toUserDto(row: UserRow): UserDto {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    color: row.color,
    createdAt: row.created_at.toISOString(),
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
