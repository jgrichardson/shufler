import { useWorld } from '../../store';
import { domainDef } from '../../lib/domains';
import { requestAction } from '../requestAction';

/** "domain: Billing (PR scope `billing`)": why a pod or workspace sits in its domain (round 3). */
export function domainLine(domain: string, reason: string | null | undefined): string {
  const label = domainDef(domain).label;
  return reason ? `domain: ${label} (${reason})` : `domain: ${label}`;
}

/** set_domain target for a pod or a workspace. */
export const domainTarget = (t: { pr: number } | { station: string }) => ('pr' in t ? `pr:${t.pr}` : `station:${t.station}`);

/**
 * The panel's domain line plus a "Move to domain…" picker. Choosing a domain goes through the
 * daemon's set_domain preview and a tap confirm; nothing changes until you confirm.
 */
export function DomainMove({ domain, reason, target, disabledReason }: { domain: string; reason: string | null | undefined; target: string | null; disabledReason?: string }) {
  const domains = useWorld((s) => s.snapshot?.domains ?? []);
  const blocked = !target || !!disabledReason;
  return (
    <div className="domain-move">
      <span className="domain-why">{domainLine(domain, reason)}</span>
      <select
        className="domain-pick"
        value=""
        disabled={blocked}
        title={disabledReason ?? (target ? 'Persist a manual alias so this moves to another domain' : 'Only PRs and workspaces can be moved')}
        onChange={(e) => {
          const to = e.target.value;
          if (!to || !target) return;
          requestAction('set_domain', { target, domain: to }, `Move to ${domainDef(to).label}`);
        }}
      >
        <option value="">Move to domain…</option>
        {domains
          .filter((d) => d.id !== domain)
          .map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
      </select>
    </div>
  );
}
