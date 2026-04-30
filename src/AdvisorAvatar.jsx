import { useState, useEffect, useRef } from 'react';

// ── Expression definitions ──────────────────────────
// Each expression defines: eyes, mouth, brows, glow color
const EXPRESSIONS = {
  neutral:     { eyes: 'open',  mouth: 'slight',  brows: 'normal',  glow: '#4b7cf3' },
  listening:   { eyes: 'soft',  mouth: 'closed',   brows: 'raised',  glow: '#7b5cf0' },
  thinking:    { eyes: 'look',  mouth: 'hmm',      brows: 'furrow',  glow: '#f0a030' },
  speaking:    { eyes: 'open',  mouth: 'open',     brows: 'normal',  glow: '#4b7cf3' },
  happy:       { eyes: 'happy', mouth: 'smile',    brows: 'raised',  glow: '#36c78d' },
  concerned:   { eyes: 'soft',  mouth: 'slight',   brows: 'furrow',  glow: '#ef5858' },
  encouraging: { eyes: 'warm',  mouth: 'smile',    brows: 'raised',  glow: '#f08040' },
};

// ── Mouth shapes for lip-sync ───────────────────────
const MOUTH_PATHS = {
  closed:  'M 34 52 Q 40 52 46 52',
  slight:  'M 34 52 Q 40 53 46 52',
  hmm:     'M 36 52 Q 40 52 44 52 Q 40 54 36 52',
  open:    'M 34 51 Q 40 56 46 51 Q 40 54 34 51',
  smile:   'M 33 50 Q 40 56 47 50',
  wide:    'M 33 50 Q 40 58 47 50 Q 40 55 33 50',
};

// Lip-sync frames cycle during speech
const LIP_FRAMES = ['closed', 'slight', 'open', 'wide', 'open', 'slight'];

// ── Eye shapes ──────────────────────────────────────
function Eyes({ type, blinkPhase }) {
  const blink = blinkPhase < 0.06;
  
  if (blink) {
    return <>
      <line x1="30" y1="40" x2="36" y2="40" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="44" y1="40" x2="50" y2="40" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </>;
  }
  
  const eyeR = type === 'soft' || type === 'warm' ? 2.2 : 2.5;
  const happySquish = type === 'happy' ? 0.7 : 1;
  
  // Pupil offset for "look" expression
  const px = type === 'look' ? 1.2 : 0;
  const py = type === 'look' ? -0.5 : 0;
  
  // Warm eyes are slightly upturned
  const warmLift = type === 'warm' ? -1 : 0;
  
  return <>
    {type === 'happy' ? <>
      <path d="M 29 41 Q 33 37 37 41" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M 43 41 Q 47 37 51 41" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </> : <>
      <ellipse cx={33 + px} cy={40 + py + warmLift} rx={eyeR} ry={eyeR * happySquish} fill="currentColor" />
      <ellipse cx={47 + px} cy={40 + py + warmLift} rx={eyeR} ry={eyeR * happySquish} fill="currentColor" />
    </>}
  </>;
}

// ── Brows ────────────────────────────────────────────
function Brows({ type }) {
  switch (type) {
    case 'raised':
      return <>
        <path d="M 28 33 Q 33 30 38 33" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
        <path d="M 42 33 Q 47 30 52 33" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </>;
    case 'furrow':
      return <>
        <path d="M 29 33 Q 33 34 37 32" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
        <path d="M 43 32 Q 47 34 51 33" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" />
      </>;
    default:
      return <>
        <path d="M 29 34 Q 33 32 37 34" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.4" />
        <path d="M 43 34 Q 47 32 51 34" fill="none" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" opacity="0.4" />
      </>;
  }
}

// ── Main Avatar Component ───────────────────────────
export default function AdvisorAvatar({ 
  expression = 'neutral', 
  isSpeaking = false,
  size = 80,
  showGlow = true,
  theme,
  style = {},
}) {
  const [blinkPhase, setBlinkPhase] = useState(1);
  const [lipFrame, setLipFrame] = useState(0);
  const [breathe, setBreathe] = useState(0);
  const frameRef = useRef(null);
  const lastBlinkRef = useRef(Date.now());
  const lipIntervalRef = useRef(null);
  
  const expr = EXPRESSIONS[expression] || EXPRESSIONS.neutral;
  
  // Idle animation: breathing + blinking
  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      const now = Date.now();
      
      // Breathing (subtle scale oscillation)
      setBreathe(Math.sin(now / 2000) * 0.008);
      
      // Blinking (random interval 2-5s)
      const timeSinceBlink = (now - lastBlinkRef.current) / 1000;
      if (timeSinceBlink > 3 + Math.random() * 3) {
        setBlinkPhase(0);
        lastBlinkRef.current = now;
        setTimeout(() => setBlinkPhase(1), 150);
      }
      
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, []);
  
  // Lip-sync animation during speech
  useEffect(() => {
    if (isSpeaking) {
      let frame = 0;
      lipIntervalRef.current = setInterval(() => {
        frame = (frame + 1) % LIP_FRAMES.length;
        setLipFrame(frame);
      }, 120);
    } else {
      clearInterval(lipIntervalRef.current);
      setLipFrame(0);
    }
    return () => clearInterval(lipIntervalRef.current);
  }, [isSpeaking]);
  
  const currentMouth = isSpeaking ? LIP_FRAMES[lipFrame] : expr.mouth;
  const scale = 1 + breathe;
  
  const t = theme || {};
  const faceColor = t.text || '#dce0ec';
  const bgFill = t.surfaceAlt || '#1c2230';
  
  return (
    <div style={{
      width: size, height: size,
      position: 'relative',
      flexShrink: 0,
      ...style,
    }}>
      {/* Glow effect behind avatar */}
      {showGlow && (
        <div style={{
          position: 'absolute',
          inset: -4,
          borderRadius: '50%',
          background: `radial-gradient(circle, ${expr.glow}30 0%, transparent 70%)`,
          transition: 'background 0.6s ease',
          animation: isSpeaking ? 'avatarPulse 1.5s ease-in-out infinite' : 'none',
        }} />
      )}
      
      <svg
        viewBox="0 0 80 80"
        width={size}
        height={size}
        style={{
          position: 'relative',
          transform: `scale(${scale})`,
          transition: 'transform 0.3s ease',
          color: faceColor,
        }}
      >
        {/* Head circle */}
        <circle cx="40" cy="40" r="30" fill={bgFill} stroke={expr.glow} strokeWidth="1.5" opacity="0.9">
          <animate attributeName="stroke-opacity" values="0.6;1;0.6" dur="3s" repeatCount="indefinite" />
        </circle>
        
        {/* Inner face circle */}
        <circle cx="40" cy="40" r="26" fill="none" stroke={expr.glow} strokeWidth="0.3" opacity="0.3" />
        
        {/* Brows */}
        <Brows type={expr.brows} />
        
        {/* Eyes */}
        <Eyes type={expr.eyes} blinkPhase={blinkPhase} />
        
        {/* Mouth */}
        <path
          d={MOUTH_PATHS[currentMouth]}
          fill={currentMouth === 'open' || currentMouth === 'wide' ? `${expr.glow}40` : 'none'}
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
          style={{ transition: 'all 0.1s ease' }}
        />
        
        {/* Speaking indicator dots */}
        {isSpeaking && (
          <g opacity="0.5">
            <circle cx="58" cy="55" r="1.5" fill={expr.glow}>
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" repeatCount="indefinite" />
            </circle>
            <circle cx="62" cy="52" r="1" fill={expr.glow}>
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0.3s" repeatCount="indefinite" />
            </circle>
            <circle cx="64" cy="48" r="0.7" fill={expr.glow}>
              <animate attributeName="opacity" values="0.3;1;0.3" dur="1s" begin="0.6s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
      </svg>
    </div>
  );
}

// ── Inline chat avatar (smaller, no glow) ───────────
export function ChatAvatar({ expression, isSpeaking, theme, isSim }) {
  if (isSim) {
    return (
      <div style={{
        width: 30, height: 30, borderRadius: 10, flexShrink: 0,
        background: `linear-gradient(135deg, ${theme.orange}, ${theme.red})`,
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13,
      }}>🎭</div>
    );
  }
  
  return (
    <AdvisorAvatar
      expression={expression}
      isSpeaking={isSpeaking}
      size={30}
      showGlow={false}
      theme={theme}
      style={{ borderRadius: 10, overflow: 'hidden' }}
    />
  );
}

// ── Determine expression from context ───────────────
export function getExpression(policy, isTyping, isSpeaking, eventOutcome) {
  if (isTyping) return 'thinking';
  if (isSpeaking) return 'speaking';
  if (eventOutcome === 'improvement') return 'happy';
  if (!policy) return 'listening';
  
  switch (policy.mode) {
    case 'safety': return 'concerned';
    case 'coach': return 'encouraging';
    case 'strategist': return 'happy';
    case 'listener': return 'listening';
    default: return 'neutral';
  }
}

// CSS for avatar animations (inject into page)
export const AVATAR_CSS = `
@keyframes avatarPulse {
  0%, 100% { transform: scale(1); opacity: 0.6; }
  50% { transform: scale(1.08); opacity: 1; }
}
`;
