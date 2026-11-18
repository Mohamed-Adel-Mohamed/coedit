export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`brand${compact ? ' brand-compact' : ''}`}>
      <svg
        className="brand-mark"
        viewBox="0 0 32 32"
        role="img"
        aria-label="CoEdit"
        fill="none"
      >
        <rect x="1.5" y="1.5" width="29" height="29" rx="8" stroke="currentColor" strokeWidth="1.6" />
        <path d="M13 10.5 8.5 16l4.5 5.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M19 10.5 23.5 16 19 21.5" stroke="#e8552f" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M17.2 9v14" stroke="currentColor" strokeWidth="1.2" strokeDasharray="2 3" opacity="0.55" />
      </svg>
      <span className="brand-word">CoEdit</span>
    </span>
  );
}
