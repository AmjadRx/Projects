'use client';

/**
 * Stats (ARCHITECTURE.md 4 and 7): the home page's readouts. Each prints its prefix, value, and
 * suffix as one run, then its label (lib/format.ts statText), and links to its proof page. The
 * prefix and suffix are optional: an emptied one keeps "" only if the stored file had it.
 */
import type { Stat } from '@/lib/types';
import { FieldGrid, ListEditor, TextField, useSiteBinding } from '../ui';
import { PageProofField, PrintedAs, TabFrame, useStoredHas } from './common';
import { printedStat, withOptionalText, withProof } from './model';

export function StatsTab() {
  const [stats, setStats] = useSiteBinding<Stat[]>('stats');
  const storedHas = useStoredHas();
  return (
    <TabFrame tab="stats" description="The readouts on the home page. A readout with a proof links to that page.">
      <ListEditor
        path="stats"
        items={stats}
        onChange={setStats}
        newItem={() => ({ value: '', label: '' })}
        label="Stats"
        addLabel="Add a stat"
        rowLabel={(stat, i) => printedStat(stat) || `Stat ${i + 1}`}
        renderRow={({ item: stat, path, update }) => (
          <>
            <FieldGrid columns={3}>
              <TextField
                path={`${path}.prefix`}
                label="Prefix"
                mono
                value={stat.prefix}
                onChange={(text, edit) => update(withOptionalText(stat, 'prefix', text, storedHas(`${path}.prefix`)), edit)}
              />
              <TextField path={`${path}.value`} label="Value" mono value={stat.value} onChange={(value, edit) => update({ ...stat, value }, edit)} />
              <TextField
                path={`${path}.suffix`}
                label="Suffix"
                mono
                value={stat.suffix}
                onChange={(text, edit) => update(withOptionalText(stat, 'suffix', text, storedHas(`${path}.suffix`)), edit)}
              />
            </FieldGrid>
            <p className="adm-muted">The prefix and suffix are optional, and spaces in them count.</p>
            <TextField path={`${path}.label`} label="Label" value={stat.label} onChange={(label, edit) => update({ ...stat, label }, edit)} />
            <PageProofField
              path={`${path}.proof`}
              hint="The page this readout links to."
              value={stat.proof}
              onChange={(proof, edit) => update(withProof(stat, proof), edit)}
            />
            <PrintedAs text={printedStat(stat)} empty="Not printed yet: add a value and a label." />
          </>
        )}
      />
    </TabFrame>
  );
}
