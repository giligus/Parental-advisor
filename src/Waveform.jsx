export default function Waveform({ active, color, bars = 32 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3, height: 36 }}>
      {Array.from({ length: bars }, (_, i) => (
        <div key={i} style={{
          width: 3,
          borderRadius: 3,
          background: color,
          height: active ? `${22 + Math.sin(i * 0.7) * 60}%` : '12%',
          opacity: active ? 0.9 : 0.2,
          animation: active ? `wv 1.1s ${(i * 0.055).toFixed(2)}s ease-in-out infinite` : 'none',
          minHeight: 3,
          transition: 'height .15s, opacity .3s',
        }}/>
      ))}
    </div>
  );
}
