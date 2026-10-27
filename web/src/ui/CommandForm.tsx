import { useEffect, useState } from 'react';
import type { CommandDef, CommandInput, NoteState, Station } from '../types';
import { STATE_COLOR } from '../lib/colors';
import { commandParams, initialValues, validateValues, type CommandValues } from './commands';
import { requestAction } from './requestAction';

/** Form state for a command, reset when the command or the station's note changes. */
export function useCommandValues(cmd: CommandDef, station?: Station | null) {
  const [values, setValues] = useState<CommandValues>(() => initialValues(cmd, station));
  useEffect(() => {
    setValues(initialValues(cmd, station));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmd.id, station?.id, station?.note?.state, station?.note?.text]);
  return [values, setValues] as const;
}

export function runCommand(cmd: CommandDef, values: CommandValues, stationId?: string | null) {
  if (validateValues(cmd, values)) return;
  requestAction('run_command', commandParams(cmd, values, stationId), cmd.label);
}

function Field({ input, value, set, onSubmit, autoFocus }: { input: CommandInput; value: string | boolean; set: (v: string | boolean) => void; onSubmit: () => void; autoFocus?: boolean }) {
  const id = `cmd-${input.name}`;
  if (input.type === 'flag')
    return (
      <label className="check">
        <input type="checkbox" checked={value === true} onChange={(e) => set(e.target.checked)} /> {input.label}
      </label>
    );
  if (input.type === 'choice')
    return (
      <div className="state-pills" role="radiogroup" aria-label={input.label}>
        {(input.choices ?? []).map((c) => (
          <button
            key={c}
            role="radio"
            aria-checked={c === value}
            className={`state-pill${c === value ? ' on' : ''}`}
            style={{
              ['--c' as string]: STATE_COLOR[c as NoteState] ?? 'var(--accent)',
            }}
            onClick={() => set(c)}
          >
            {c}
          </button>
        ))}
      </div>
    );
  const text = typeof value === 'string' ? value : '';
  const over = !!input.max && text.length > input.max;
  const counter = input.max ? (
    <span className={`counter${over ? ' bad-text' : ''}`}>
      {text.length}/{input.max}
    </span>
  ) : null;
  if (input.multiline)
    return (
      <>
        <textarea
          id={id}
          aria-label={input.label}
          className={`input mono cmd-text${over ? ' invalid' : ''}`}
          rows={6}
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={input.placeholder}
          value={text}
          onChange={(e) => set(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit();
          }}
        />
        {counter}
      </>
    );
  return (
    <>
      <input
        id={id}
        aria-label={input.label}
        className={`input${over ? ' invalid' : ''}`}
        autoFocus={autoFocus}
        placeholder={input.placeholder ?? input.label}
        value={text}
        onChange={(e) => set(e.target.value.replace(/\n/g, ' '))}
        onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
      />
      {counter}
    </>
  );
}

/**
 * The fields for a command's inputs plus its Run button. Choice inputs come first as pills, then text and flags
 * on one row, so a two-input "state + text" command reads like a session note editor.
 */
export function CommandFields({
  cmd,
  values,
  setValues,
  stationId,
  autoFocus,
}: {
  cmd: CommandDef;
  values: CommandValues;
  setValues: (v: CommandValues) => void;
  stationId?: string | null;
  autoFocus?: boolean;
}) {
  const inputs = Array.isArray(cmd.inputs) ? cmd.inputs : [];
  const error = validateValues(cmd, values);
  const submit = () => runCommand(cmd, values, stationId);
  const set = (name: string) => (v: string | boolean) => setValues({ ...values, [name]: v });
  const choices = inputs.filter((i) => i.type === 'choice');
  const rest = inputs.filter((i) => i.type !== 'choice');
  const firstText = rest.find((i) => i.type === 'text');
  return (
    <div className="cmd-form">
      {choices.map((i) => (
        <Field key={i.name} input={i} value={values[i.name] ?? ''} set={set(i.name)} onSubmit={submit} />
      ))}
      <div className={rest.some((i) => i.multiline) ? 'cmd-stack' : 'reply-row'}>
        {rest.map((i) => (
          <Field key={i.name} input={i} value={values[i.name] ?? ''} set={set(i.name)} onSubmit={submit} autoFocus={autoFocus && i === firstText} />
        ))}
        <button className={`btn${cmd.prod ? ' prod' : ''}`} disabled={!!error} title={error ?? cmd.description} onClick={submit}>
          {inputs.some((i) => i.multiline) ? (
            <>
              Run <kbd>⌘↵</kbd>
            </>
          ) : (
            'Run'
          )}
        </button>
      </div>
    </div>
  );
}

/** A command as an inline form (panels), with its description as a hint. */
export function InlineCommand({ cmd, station }: { cmd: CommandDef; station?: Station | null }) {
  const [values, setValues] = useCommandValues(cmd, station);
  return <CommandFields cmd={cmd} values={values} setValues={setValues} stationId={station?.id} />;
}
