'use client';

import { useEffect, useState } from 'react';
import type { Awareness } from 'y-protocols/awareness';
import { initials } from '@/lib/format';

interface PresenceUser {
  id: string | null;
  name: string;
  color: string;
  role?: string;
}

export function PresenceBar({ awareness }: { awareness: Awareness }) {
  const [users, setUsers] = useState<PresenceUser[]>([]);

  useEffect(() => {
    const update = (): void => {
      const collected: PresenceUser[] = [];
      for (const state of awareness.getStates().values()) {
        const user = (state as { user?: Partial<PresenceUser> }).user;
        if (user && typeof user.name === 'string') {
          collected.push({
            id: user.id ?? null,
            name: user.name,
            color: typeof user.color === 'string' ? user.color : '#8b8574',
            role: typeof user.role === 'string' ? user.role : undefined,
          });
        }
      }
      collected.sort((a, b) => a.name.localeCompare(b.name));
      setUsers(collected);
    };
    update();
    awareness.on('change', update);
    return () => {
      awareness.off('change', update);
    };
  }, [awareness]);

  if (users.length === 0) {
    return <span className="presence-empty">Only you here</span>;
  }

  const visible = users.slice(0, 4);
  const overflow = users.length - visible.length;

  return (
    <div className="presence" title={users.map((user) => user.name).join(', ')}>
      {visible.map((user, index) => (
        <span
          key={`${user.name}-${user.id ?? index}`}
          className="avatar"
          style={{ backgroundColor: user.color }}
          title={`${user.name}${user.role ? ` · ${user.role}` : ''}`}
        >
          {initials(user.name)}
        </span>
      ))}
      {overflow > 0 ? <span className="avatar avatar-more">+{overflow}</span> : null}
    </div>
  );
}
