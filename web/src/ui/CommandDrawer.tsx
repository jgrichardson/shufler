import { useEffect, useMemo, useState } from 'react';
import { dispatch, useCaps, useWorld } from '../store';
import { globalCommands, historyLabel, loadCommandHistory, parseTableOutput, type CommandValues } from './commands';
import { CommandFields, useCommandValues } from './CommandForm';
import type { CommandDef } from '../types';

/** The drawer for global commands (the / key): pick a command, fill its form, run it, read the output. */
export function CommandDrawer() {
  const open = useWorld((s) => s.commandDrawer.open);
  const wanted = useWorld((s) => s.commandDrawer.id);
  const caps = useCaps();
  const commands = globalCommands(caps);
  const cmd = commands.find((c) => c.id === wanted) ?? commands[0];
  return (
    <div className={`drawer glass ${open ? 'open' : ''}`} aria-hidden={!open}>
      <div className="drawer-head">
        <div>
          <div className="modal-kicker">Commands</div>
          <div className="drawer-sub">{cmd ? cmd.description || cmd.label : 'No commands configured. Add a [[command]] to the config file.'}</div>
        </div>
        <button className="btn ghost sm" onClick={() => dispatch({ type: 'command_drawer', open: false })}>
          Close <kbd>Esc</kbd>
        </button>
      </div>
      {cmd && <DrawerBody key={cmd.id} cmd={cmd} commands={commands} open={open} />}
    </div>
  );
}

function DrawerBody({ cmd, commands, open }: { cmd: CommandDef; commands: CommandDef[]; open: boolean }) {
  const last = useWorld((s) => s.commandResult);
  const result = last?.id === cmd.id ? last.result : null;
  const [values, setValues] = useCommandValues(cmd);
  const [history, setHistory] = useState<CommandValues[]>(() => loadCommandHistory(cmd.id));

  useEffect(() => {
    const h = () => setHistory(loadCommandHistory(cmd.id));
    window.addEventListener('command-history', h);
    return () => window.removeEventListener('command-history', h);
  }, [cmd.id]);

  const table = useMemo(() => (result?.ok ? parseTableOutput(result.output) : null), [result]);

  return (
    <div className="drawer-body">
      <div className="cmd-left">
        {commands.length > 1 && (
          <div className="state-pills cmd-picker" role="tablist" aria-label="Command">
            {commands.map((c) => (
              <button
                key={c.id}
                role="tab"
                aria-selected={c.id === cmd.id}
                className={`state-pill${c.id === cmd.id ? ' on' : ''}`}
                style={{
                  ['--c' as string]: c.prod ? 'var(--me)' : 'var(--accent)',
                }}
                onClick={() => dispatch({ type: 'command_drawer', open: true, id: c.id })}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
        {cmd.prod && <div className="prod-banner">Production</div>}
        {open && <CommandFields cmd={cmd} values={values} setValues={setValues} autoFocus />}
        {history.length > 0 && (
          <div className="history">
            <div className="subhead">Recent</div>
            {history.map((h) => {
              const label = historyLabel(h);
              return (
                <button key={JSON.stringify(h)} className="history-item mono" onClick={() => setValues({ ...values, ...h })} title={label}>
                  {label || '(no inputs)'}
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="cmd-right">
        {!result && <div className="empty">Output shows here after you confirm a run.</div>}
        {result && !result.ok && (
          <pre className="command error">
            {result.error ?? 'Command failed'}
            {'\n'}
            {result.output}
          </pre>
        )}
        {result && result.ok && table && (
          <div className="table-wrap">
            <table className="results">
              <thead>
                <tr>
                  {table.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((v, j) => (
                      <td key={j} className={v == null ? 'null' : typeof v === 'number' ? 'num' : ''}>
                        {v == null ? 'null' : String(v)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="hint">{table.rows.length} rows</div>
          </div>
        )}
        {result && result.ok && !table && <pre className="command">{result.output || '(no output)'}</pre>}
      </div>
    </div>
  );
}
