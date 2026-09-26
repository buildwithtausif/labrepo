import React, { useEffect, useState } from 'react';

interface Announcement {
  id: number;
  title: string;
  message: string;
  url: string | null;
  urlLabel: string | null;
  type: 'info' | 'success' | 'warning' | 'critical';
}

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;

    async function fetchAnnouncements() {
      try {
        const res = await fetch('/api/announcements/active');
        if (res.ok) {
          const data = await res.json();
          if (data.announcements) {
            setAnnouncements(data.announcements);
          }
        }
      } catch (err) {
        console.error('Failed to fetch announcements:', err);
      } finally {
        timeoutId = setTimeout(fetchAnnouncements, 60000);
      }
    }

    fetchAnnouncements();
    return () => clearTimeout(timeoutId);
  }, []);

  const visible = announcements.filter((a) => !dismissed.has(a.id));
  if (visible.length === 0) return null;

  return (
    <div style={{ position: 'relative', zIndex: 'var(--z-announcement)' }}>
      {visible.map((a) => {
        const colors: Record<string, { bg: string; border: string; icon: string }> = {
          info: { bg: 'rgba(99,149,255,0.08)', border: 'rgba(99,149,255,0.2)', icon: 'bi-info-circle-fill' },
          success: { bg: 'rgba(73,184,122,0.08)', border: 'rgba(73,184,122,0.2)', icon: 'bi-check-circle-fill' },
          warning: { bg: 'rgba(246,182,83,0.08)', border: 'rgba(246,182,83,0.2)', icon: 'bi-exclamation-triangle-fill' },
          critical: { bg: 'rgba(255,102,102,0.08)', border: 'rgba(255,102,102,0.2)', icon: 'bi-exclamation-octagon-fill' },
        };
        const c = colors[a.type] || colors.info;
        return (
          <div key={a.id} style={{
            width: '100%',
            background: c.bg,
            borderBottom: `1px solid ${c.border}`,
            padding: '10px 16px',
            fontSize: '0.875rem',
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: '12px',
              maxWidth: '1200px',
              margin: '0 auto',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: '1 1 200px', minWidth: 0 }}>
                <i className={`bi ${c.icon}`} style={{ fontSize: '1.1rem', marginTop: '1px', flexShrink: 0 }}></i>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontWeight: 600, color: 'var(--color-ink)', letterSpacing: '-0.01em' }}>
                    {a.title}
                  </span>
                  <span style={{ color: 'var(--color-ink-muted)', lineHeight: 1.5 }}>
                    {a.message}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0, marginLeft: 'auto' }}>
                {a.url && (
                  <a href={a.url} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '5px 12px', borderRadius: '6px', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--color-ink)', fontWeight: 600, fontSize: '0.8rem', textDecoration: 'none', whiteSpace: 'nowrap', transition: 'background 0.15s' }}
                  >
                    <i className="bi bi-sparkles" style={{ fontSize: '0.85rem' }}></i>
                    {a.urlLabel || 'Try it now'}
                  </a>
                )}
                <button
                  onClick={() => setDismissed((prev) => new Set(prev).add(a.id))}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-ink-muted)', display: 'flex', alignItems: 'center' }}
                  aria-label="Dismiss"
                >
                  <i className="bi bi-x-lg" style={{ fontSize: '0.9rem' }}></i>
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
