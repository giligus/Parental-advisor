import { useState } from 'react';
import { PERSONAS } from './personas';

export default function PersonaSelect({ lang, onSelect }) {
  const [hov, setHov] = useState(null);
  const isHe = lang === 'he';

  return (
    <div style={{
      height: '100%',
      paddingTop: 'var(--sat)',
      paddingBottom: 'var(--sab)',
      background: '#04060d',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: `calc(var(--sat) + 24px) 16px calc(var(--sab) + 16px)`,
      direction: isHe ? 'rtl' : 'ltr',
      backgroundImage: 'radial-gradient(ellipse 60% 40% at 50% 30%, rgba(75,124,243,0.08) 0%, transparent 70%)',
      overflow: 'auto',
    }}>
      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: 32, animation: 'fadeIn .6s ease' }}>
        <div style={{ fontSize: 10, letterSpacing: 4, color: '#4b9cf3', marginBottom: 8, fontWeight: 700 }}>
          BEHAVIORAL ADVISOR
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, color: '#e8edf8', letterSpacing: -0.5, marginBottom: 8 }}>
          {isHe ? 'בחרו את היועץ שלכם' : 'Choose your advisor'}
        </div>
        <div style={{ fontSize: 13, color: '#3a4460', lineHeight: 1.6, maxWidth: 300, margin: '0 auto' }}>
          {isHe
            ? 'דמות שתדבר אתכם, תקשיב, ותלווה אתכם לאורך זמן'
            : 'A persona that will speak with you, listen, and guide you over time'}
        </div>
      </div>

      {/* Cards */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'center' }}>
        {PERSONAS.map((p, idx) => {
          const h = hov === p.id;
          return (
            <button key={p.id}
              onMouseEnter={() => setHov(p.id)}
              onMouseLeave={() => setHov(null)}
              onTouchStart={() => setHov(p.id)}
              onTouchEnd={() => { setHov(null); onSelect(p); }}
              onClick={() => onSelect(p)}
              style={{
                width: 210, padding: 0, border: 'none', cursor: 'pointer',
                borderRadius: 22, overflow: 'hidden', fontFamily: 'inherit',
                background: '#0c1520',
                outline: `2px solid ${h ? p.accent : '#1c2535'}`,
                transition: 'all .3s ease',
                transform: h ? 'translateY(-8px) scale(1.03)' : 'none',
                boxShadow: h ? `0 24px 56px ${p.glow}` : '0 2px 14px rgba(0,0,0,.5)',
                animation: `fadeIn .5s ease ${idx * 0.12 + 0.2}s both`,
              }}
            >
              <div style={{ width: '100%', aspectRatio: '3/4', overflow: 'hidden', position: 'relative' }}>
                <img src={p.img} alt={isHe ? p.name : p.nameEn} style={{
                  width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top',
                  transform: h ? 'scale(1.06)' : 'scale(1)',
                  transition: 'transform .4s', display: 'block',
                }}/>
                <div style={{
                  position: 'absolute', bottom: 0, left: 0, right: 0, height: 90,
                  background: `linear-gradient(to bottom, transparent, ${h ? '#0a1a2a' : '#0c1520'})`,
                }}/>
                {h && <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none',
                  boxShadow: `inset 0 0 70px ${p.glow}`,
                }}/>}
              </div>
              <div style={{ padding: '12px 16px 16px', textAlign: isHe ? 'right' : 'left' }}>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#e8edf8' }}>
                  {isHe ? p.name : p.nameEn}
                </div>
                <div style={{ fontSize: 11, color: p.accent, fontWeight: 600, marginBottom: 10 }}>
                  {isHe ? p.role : p.roleEn}
                </div>
                <div style={{
                  padding: '8px 0', borderRadius: 10, textAlign: 'center',
                  background: h ? p.accent : '#19253a',
                  color: h ? '#fff' : '#3a4460',
                  fontSize: 13, fontWeight: 600, transition: 'all .2s',
                }}>
                  {isHe ? 'בחר' : 'Select'}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      <button onClick={() => onSelect(null)} style={{
        marginTop: 20, padding: '7px 18px', borderRadius: 99,
        border: '1px solid #1c2535', background: 'transparent',
        color: '#3a4460', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
      }}>
        {isHe ? 'המשך ללא אווטאר' : 'Continue without avatar'}
      </button>
    </div>
  );
}
