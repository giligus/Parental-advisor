import React from 'react';

export function Gauge({ label, value, color, t }) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4, color: t.textSoft }}>
        <span>{label}</span>
        <span style={{ fontSize: 12, color, fontWeight: 500 }}>{pct}%</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: t.border }}>
        <div style={{
          height: '100%', borderRadius: 3,
          width: `${pct}%`, background: color,
          transition: 'width 0.8s ease',
        }} />
      </div>
    </div>
  );
}

export function ProfileCard({ profile, t, isHe }) {
  const Section = ({ label, items, color }) => {
    if (!items?.length) return null;
    return (
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 11, color, fontWeight: 600 }}>{label}</span>
        <div style={{ fontSize: 12, color: t.textSoft, marginTop: 3 }}>{items.join(' · ')}</div>
      </div>
    );
  };

  return (
    <div style={{
      background: t.surfaceAlt, borderRadius: 12, padding: 14,
      marginBottom: 10, border: `1px solid ${t.border}`,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>{profile.name}</span>
        <span style={{
          fontSize: 11, color: t.textDim,
          background: t.accentSoft, padding: '2px 8px', borderRadius: 6,
        }}>
          {profile.role}{profile.age ? ` · ${isHe ? 'בן' : 'age'} ${profile.age}` : ''}
        </span>
      </div>
      <Section label={isHe ? 'אתגרים' : 'Challenges'} items={profile.challenges} color={t.red} />
      <Section label={isHe ? 'חוזקות' : 'Strengths'} items={profile.strengths} color={t.green} />
      <Section label={isHe ? 'טריגרים' : 'Triggers'} items={profile.triggers} color={t.amber} />
      <Section label={isHe ? 'מה עובד' : 'What works'} items={profile.whatWorks} color={t.green} />
      {profile.notes && (
        <div style={{ fontSize: 12, color: t.textDim, marginTop: 6, fontStyle: 'italic' }}>{profile.notes}</div>
      )}
    </div>
  );
}

export function TypingIndicator({ t }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, animation: 'slideIn .3s ease' }}>
      <div style={{
        width: 30, height: 30, borderRadius: 10,
        background: `linear-gradient(135deg, ${t.accent}, ${t.purple})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 14, flexShrink: 0,
      }}>🧠</div>
      <div style={{
        display: 'flex', gap: 5, padding: '12px 16px',
        background: t.advisorBubble, borderRadius: '16px 16px 16px 4px',
      }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            width: 6, height: 6, borderRadius: '50%',
            background: t.accent,
            animation: `bounce 1.2s ${i * 0.16}s infinite ease-in-out`,
          }} />
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, subtitle, actionLabel, onAction, t }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>{icon}</div>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{
        fontSize: 13, color: t.textDim,
        maxWidth: 260, margin: '0 auto', lineHeight: 1.6,
      }}>{subtitle}</div>
      {actionLabel && (
        <button onClick={onAction} style={{
          marginTop: 16, padding: '10px 22px', borderRadius: 12,
          border: 'none', background: t.accent, color: '#fff',
          fontWeight: 600, fontSize: 13, cursor: 'pointer',
          fontFamily: 'inherit',
        }}>{actionLabel}</button>
      )}
    </div>
  );
}
