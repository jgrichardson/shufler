import { Fragment, type ReactNode } from 'react';
import { CopyButton } from './common';

/** Small, safe markdown renderer (no HTML passthrough): fenced code, lists, headings, bold, italics, inline code, links. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)|(\*[^*\s][^*]*\*)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) {
      const label = m[3].slice(1, m[3].indexOf(']'));
      out.push(
        <a key={k} href={m[4]} target="_blank" rel="noreferrer noopener">
          {label}
        </a>,
      );
    } else if (m[5])
      out.push(
        <a key={k} href={m[5]} target="_blank" rel="noreferrer noopener">
          {m[5]}
        </a>,
      );
    else if (m[6]) out.push(<em key={k}>{m[6].slice(1, -1)}</em>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) body.push(lines[i++]);
      i++;
      const code = body.join('\n');
      blocks.push(
        <div key={key++} className="md-code">
          <CopyButton text={code} />
          <pre>{code}</pre>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''));
      const Tag = ordered ? 'ol' : 'ul';
      blocks.push(
        <Tag key={key++}>
          {items.map((it, j) => (
            <li key={j}>{inline(it, `${key}-${j}`)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push(
        <div key={key++} className={`md-h md-h${h[1].length}`}>
          {inline(h[2], `h${key}`)}
        </div>,
      );
      i++;
      continue;
    }
    if (line.startsWith('|') && i + 1 < lines.length && /^\|?[\s:-]+\|/.test(lines[i + 1])) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!/^\|?[\s:|-]+$/.test(lines[i])) rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim()));
        i++;
      }
      blocks.push(
        <div key={key++} className="md-table">
          <table>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (ri === 0 ? <th key={ci}>{inline(c, `t${ri}${ci}`)}</th> : <td key={ci}>{inline(c, `t${ri}${ci}`)}</td>))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith('```') && !/^\s*([-*]|\d+\.)\s+/.test(lines[i]) && !/^#{1,4}\s/.test(lines[i])) para.push(lines[i++]);
    blocks.push(
      <p key={key++}>
        {para.map((p, j) => (
          <Fragment key={j}>
            {j > 0 && <br />}
            {inline(p, `p${key}-${j}`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
