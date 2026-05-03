import { useState, useEffect } from 'react';
import PersonaSelect from './PersonaSelect';
import Advisor from './Advisor';

export default function App() {
  const [screen, setScreen] = useState('select');
  const [persona, setPersona] = useState(null);
  const [lang] = useState('he'); // or detect from browser: navigator.language.startsWith('he') ? 'he' : 'en'

  // Fix height for mobile browsers (100dvh fallback)
  useEffect(() => {
    const fix = () => {
      const el = document.getElementById('root');
      if (el) el.style.height = window.innerHeight + 'px';
    };
    fix();
    window.addEventListener('resize', fix);
    return () => window.removeEventListener('resize', fix);
  }, []);

  if (screen === 'select') {
    return (
      <PersonaSelect
        lang={lang}
        onSelect={p => { setPersona(p); setScreen('chat'); }}
      />
    );
  }

  return (
    <Advisor
      persona={persona}
      lang={lang}
      onBack={() => setScreen('select')}
    />
  );
}
