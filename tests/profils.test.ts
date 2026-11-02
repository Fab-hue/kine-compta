import { describe, expect, it } from 'vitest';
import { basculerPaiement, estVide, fusionner, montantCreneau, profilsPatients, resteCreneau, type Creneau } from '../src/lib/creneaux';

const c = (id: string, ch: Partial<Creneau>): Creneau => ({ id, date: id.slice(0, 10), debut: 540, fin: 570, ...ch });
const seance = montantCreneau(c('x', { statut: 'paye', mode: 'tiers' }))!;
const total = Math.round((seance.patient + seance.mutuelle) * 100) / 100;

describe('profils patients', () => {
  it('un créneau avec seulement un nom de patient est gardé', () => {
    expect(estVide(c('2026-11-02|09:00', { patient: 'DUPONT Jean' }))).toBe(false);
  });

  it('la fusion garde le nom du patient', () => {
    const jour = [c('2026-11-02|09:00', {}), c('2026-11-02|09:30', { debut: 570, fin: 600, patient: 'DUPONT Jean' })];
    expect(fusionner(jour, 0, 1)!.fusion).toMatchObject({ patient: 'DUPONT Jean', debut: 540, fin: 600 });
  });

  it('regroupe par patient : total, payé, reste, à compléter', () => {
    const p = profilsPatients([
      c('2026-11-02|09:00', { patient: 'DUPONT Jean', statut: 'paye', mode: 'tiers' }),
      c('2026-11-03|09:00', { patient: 'DUPONT Jean', statut: 'arecevoir', mode: 'tiers' }),
      c('2026-11-04|09:00', { patient: 'DUPONT Jean', statut: 'arecevoir', mode: 'tiers', patientPaye: true }),
      c('2026-11-05|09:00', { patient: 'DUPONT Jean' }),
      c('2026-11-02|10:00', { patient: 'MARTIN Léa', statut: 'paye', mode: 'tiers' }),
      c('2026-11-02|11:00', { statut: 'arecevoir', mode: 'tiers' }),
      c('2026-11-02|12:00', { commentaire: 'pause' }),
    ]);
    expect(p.map((x) => x.nom)).toEqual(['DUPONT Jean', 'MARTIN Léa', '']);
    const [dupont] = p;
    expect(dupont.seances.map((s) => s.date)).toEqual(['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-02']);
    expect(dupont.aCompleter).toBe(1);
    expect(dupont.total).toBeCloseTo(3 * total, 2);
    expect(dupont.reste).toBeCloseTo(total + seance.mutuelle, 2);
    expect(dupont.paye).toBeCloseTo(total + seance.patient, 2);
  });

  it('bascule payé / à recevoir', () => {
    const a = c('x', { statut: 'arecevoir', mode: 'tiers', patientPaye: true });
    const b = basculerPaiement(a);
    expect(b.statut).toBe('paye');
    expect(b.patientPaye).toBeUndefined();
    expect(resteCreneau(b)).toBe(0);
    expect(basculerPaiement(b).statut).toBe('arecevoir');
    expect(resteCreneau(basculerPaiement(b))).toBeCloseTo(total, 2);
  });
});
