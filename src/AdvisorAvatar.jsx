import { useEffect, useRef, useState } from 'react';

const CHARACTER_SRC = '/advisor-character.png';

const EXPRESSIONS = {
  neutral: { glow: '#4b7cf3', filter: 'saturate(1.02) brightness(1)', mood: 'calm' },
  listening: { glow: '#7b5cf0', filter: 'saturate(1.02) brightness(0.98)', mood: 'soft' },
  thinking: { glow: '#f0a030', filter: 'saturate(1.05) brightness(0.96)', mood: 'focused' },
  speaking: { glow: '#4b7cf3', filter: 'saturate(1.08) brightness(1.04)', mood: 'speaking' },
  happy: { glow: '#36c78d', filter: 'saturate(1.12) brightness(1.04)', mood: 'warm' },
  concerned: { glow: '#ef5858', filter: 'saturate(0.96) brightness(0.94)', mood: 'serious' },
  encouraging: { glow: '#f08040', filter: 'saturate(1.08) brightness(1.03)', mood: 'warm' },
};

function useBreathing(isSpeaking) {
  const [breath, setBreath] = useState(0);
  const frameRef = useRef(null);

  useEffect(() => {
    let running = true;
    const animate = () => {
      if (!running) return;
      const speed = isSpeaking ? 620 : 1800;
      const amount = isSpeaking ? 0.018 : 0.008;
      setBreath(Math.sin(Date.now() / speed) * amount);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [isSpeaking]);

  return breath;
}

export default function AdvisorAvatar({
  expression = 'neutral',
  isSpeaking = false,
  size = 80,
  showGlow = true,
  theme,
  style = {},
}) {
  const expr = EXPRESSIONS[isSpeaking ? 'speaking' : expression] || EXPRESSIONS.neutral;
  const breath = useBreathing(isSpeaking);
  const t = theme || {};
  const scale = 1 + breath;
  const ringColor = expr.glow;
  const imageScale = size >= 180 ? 1.12 : size >= 64 ? 1.78 : 1.7;
  const speakingImageScale = imageScale + (size >= 180 ? 0.02 : 0.03);

  return (
    <div
      className={`advisor-character advisor-character-${expr.mood}${isSpeaking ? ' advisor-character-speaking' : ''}`}
      style={{
        width: size,
        height: size,
        position: 'relative',
        flexShrink: 0,
        isolation: 'isolate',
        ...style,
      }}
      aria-label="Virtual advisor avatar"
    >
      {showGlow && (
        <div
          className="advisor-character-glow"
          style={{
            position: 'absolute',
            inset: -Math.max(6, size * 0.09),
            borderRadius: '50%',
            background: `radial-gradient(circle, ${ringColor}42 0%, ${ringColor}18 40%, transparent 72%)`,
          }}
        />
      )}

      <div
        className="advisor-character-frame"
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: size >= 72 ? '28%' : '34%',
          overflow: 'hidden',
          background: t.surfaceAlt || '#1c2230',
          border: `1px solid ${ringColor}70`,
          boxShadow: `0 0 ${Math.max(10, size * 0.25)}px ${ringColor}32`,
          transform: `scale(${scale})`,
          transition: 'border-color 300ms ease, box-shadow 300ms ease, filter 300ms ease',
        }}
      >
        <img
          src={CHARACTER_SRC}
          alt=""
          draggable="false"
          className="advisor-character-image"
          style={{
            '--advisor-image-scale': String(imageScale),
            '--advisor-image-speak-scale': String(speakingImageScale),
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            objectPosition: size >= 180 ? '50% 30%' : size >= 64 ? '50% 18%' : '50% 22%',
            transform: `scale(${imageScale})`,
            filter: expr.filter,
            transformOrigin: size >= 180 ? '50% 34%' : '50% 22%',
          }}
        />

        <div
          className="advisor-character-shine"
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(135deg, transparent 0%, transparent 48%, ${ringColor}24 52%, transparent 62%)`,
            mixBlendMode: 'screen',
            pointerEvents: 'none',
          }}
        />

        {isSpeaking && (
          <>
            <div className="advisor-sound-mouth" style={{ background: ringColor }} />
            <div className="advisor-sound-bars" aria-hidden="true">
              <span style={{ background: ringColor }} />
              <span style={{ background: ringColor }} />
              <span style={{ background: ringColor }} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ChatAvatar({ expression, isSpeaking, theme, isSim }) {
  if (isSim) {
    return (
      <div style={{
        width: 30,
        height: 30,
        borderRadius: 10,
        flexShrink: 0,
        background: `linear-gradient(135deg, ${theme.orange}, ${theme.red})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
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

export const AVATAR_CSS = `
@keyframes advisorCharacterGlow {
  0%, 100% { opacity: 0.62; transform: scale(0.96); }
  50% { opacity: 1; transform: scale(1.08); }
}

@keyframes advisorCharacterSpeak {
  0%, 100% { transform: translateY(0) scale(var(--advisor-image-scale, 1.78)); }
  50% { transform: translateY(-0.8%) scale(var(--advisor-image-speak-scale, 1.81)); }
}

@keyframes advisorMouthPulse {
  0%, 100% { transform: translateX(-50%) scaleX(0.66); opacity: 0.42; }
  50% { transform: translateX(-50%) scaleX(1.08); opacity: 0.82; }
}

@keyframes advisorBar {
  0%, 100% { height: 4px; opacity: 0.45; }
  50% { height: 13px; opacity: 1; }
}

.advisor-character-glow {
  animation: advisorCharacterGlow 2.8s ease-in-out infinite;
  pointer-events: none;
  z-index: -1;
}

.advisor-character-speaking .advisor-character-glow {
  animation-duration: 1.15s;
}

.advisor-character-image {
  user-select: none;
  transition: filter 300ms ease;
}

.advisor-character-speaking .advisor-character-image {
  animation: advisorCharacterSpeak 680ms ease-in-out infinite;
}

.advisor-character-thinking .advisor-character-frame {
  filter: contrast(1.02);
}

.advisor-character-serious .advisor-character-frame {
  filter: saturate(0.95);
}

.advisor-sound-mouth {
  position: absolute;
  left: 50%;
  top: 47%;
  width: 18%;
  height: 3%;
  border-radius: 999px;
  opacity: 0.7;
  box-shadow: 0 0 10px currentColor;
  animation: advisorMouthPulse 180ms ease-in-out infinite;
}

.advisor-sound-bars {
  position: absolute;
  right: 10%;
  bottom: 12%;
  display: flex;
  align-items: end;
  gap: 2px;
  height: 14px;
}

.advisor-sound-bars span {
  width: 3px;
  min-height: 4px;
  border-radius: 999px;
  animation: advisorBar 520ms ease-in-out infinite;
}

.advisor-sound-bars span:nth-child(2) { animation-delay: 120ms; }
.advisor-sound-bars span:nth-child(3) { animation-delay: 240ms; }
`;
