import { useState } from 'react';
import { useWorld } from '../../store';
import { pinnedSkills, runSkill } from '../skills';
import { Section } from './common';

/** Pinned skills as buttons for one panel context; the session panel also gets the question skills as ask boxes. Re-reads on snapshot change. */
export function SkillButtons({ where, stationId, pr, title = 'Skills' }: { where: 'pr' | 'global' | 'station'; stationId?: string | null; pr?: number | null; title?: string }) {
  useWorld((s) => s.snapshot?.skills);
  const plain = pinnedSkills(where);
  const question = where === 'station' ? pinnedSkills('question') : [];
  const [ask, setAsk] = useState('');
  if (!plain.length && !question.length) return null;
  return (
    <Section title={title}>
      {plain.length > 0 && (
        <div className="btn-row wrap">
          {plain.map((s) => (
            <button key={s.name} className="btn skill-btn" title={s.description} onClick={() => runSkill(s, { station_id: stationId ?? null, pr: pr ?? null })}>
              {s.slash}
            </button>
          ))}
        </div>
      )}
      {question.map((s) => (
        <div key={s.name} className="reply-row">
          <input className="input" placeholder={`${s.slash} question…`} value={ask} onChange={(e) => setAsk(e.target.value)} />
          <button className="btn" disabled={!ask.trim()} onClick={() => runSkill(s, { station_id: stationId ?? null, text: ask.trim(), args: `"${ask.trim().replace(/"/g, "'")}"` })}>
            Ask
          </button>
        </div>
      ))}
    </Section>
  );
}
