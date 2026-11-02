import { describe, expect, it } from 'vitest';
import { basDuBloc, dateEntete, lireAgendaRosa, nomDuBloc, recalerAxe, versGrille, type LigneOcr, type Pixels } from '../src/lib/agendaRosa';

// Capture fictive : axe à x = 424, 8:30 centré à y = 967, 158 px par demi-heure (≈ 5,27 px/min).
const PX_MIN = 158 / 30;
const yDe = (min: number) => 967 + (min - 510) * PX_MIN;
const libelle = (min: number, texte?: string): LigneOcr => ({
  texte: texte ?? `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`,
  x: 424, y: yDe(min) - 10, h: 20,
});
const axe = [510, 540, 570, 600, 630, 660, 690, 720, 750, 780, 810, 840].map((m) => libelle(m));
/** ligne de nom : le haut du texte est ≈ 18 px sous le haut du bloc */
const nom = (min: number, texte: string, x = 545): LigneOcr => ({ texte, x, y: yDe(min) + 18, h: 24 });

describe('agenda Rosa (capture)', () => {
  it('recale l\'axe malgré un libellé mal lu', () => {
    const a = recalerAxe([...axe, libelle(810, '18:30'), libelle(600, '10.00'), libelle(630, '1030')])!;
    expect(a.b).toBeCloseTo(PX_MIN, 2);
    expect((yDe(720) - a.a) / a.b).toBeCloseTo(720, 0);
  });

  it('lit la date de l\'en-tête', () => {
    expect(dateEntete('Lun. 2 nov. 2026')).toBe('2026-11-02');
    expect(dateEntete('2 nov. 2026')).toBe('2026-11-02');
    expect(dateEntete('Mer.17déc.2025')).toBe('2025-12-17');
    expect(dateEntete('22:05')).toBeUndefined();
  });

  it('extrait le nom avant « consultation »', () => {
    expect(nomDuBloc('DUPONT Jean - consultation générale')).toBe('DUPONT Jean');
    expect(nomDuBloc('°MARTIN Léa — c0nsultation')).toBe('MARTIN Léa');
    expect(nomDuBloc('Absence')).toBeNull();
    expect(nomDuBloc('- consultation générale')).toBeNull();
  });

  it('place les rendez-vous, fusionne les passages et préfère la lecture complète', () => {
    const p1 = [...axe, nom(540, 'DUPONT Jean - consultation générale'), nom(600, 'nt - consultation', 700),
      nom(795, 'LEROY anne - consultation générale')];
    const p2 = [nom(600, 'DURANT Marc - consultation générale'),
      { texte: '13h15 - 13h45', x: 545, y: yDe(795) + 48, h: 20 }];
    const { rdv } = lireAgendaRosa([p1, p2]);
    expect(rdv.map((r) => [r.nom, r.debut, r.fin, r.source])).toEqual([
      ['DUPONT Jean', 540, 570, 'defaut'],
      ['DURANT Marc', 600, 630, 'defaut'],
      ['LEROY anne', 795, 825, 'texte'],
    ]);
    expect(rdv[2].douteux).toBe(true); // prénom en minuscule : pas le format « NOM Prénom »
    expect(rdv[0].douteux).toBe(false);
  });

  it('mesure la fin d\'un bloc d\'une heure sur l\'image', () => {
    const width = 1000;
    const height = Math.ceil(yDe(720));
    const data = new Uint8ClampedArray(width * height * 4).fill(255);
    // bloc turquoise de 10:00 à 11:00, colonne x 500-900
    for (let y = Math.round(yDe(600)); y < Math.round(yDe(660)); y++) {
      for (let x = 500; x < 900; x++) data.set([40, 170, 170, 255], (y * width + x) * 4);
    }
    const px: Pixels = { width, height, data };
    expect(basDuBloc(px, 520, yDe(610))).toBe(Math.round(yDe(660)) - 1);
    const { rdv } = lireAgendaRosa([[...axe, nom(600, 'DUPONT Jean - consultation')]], px);
    expect(rdv[0]).toMatchObject({ debut: 600, fin: 660, source: 'bloc' });
  });

  it('cale un rendez-vous hors grille sur les créneaux de 30 min', () => {
    expect(versGrille({ debut: 795, fin: 825 })).toEqual({ debut: 780, fin: 810 });
    expect(versGrille({ debut: 600, fin: 660 })).toEqual({ debut: 600, fin: 660 });
    expect(versGrille({ debut: 600, fin: 610 })).toEqual({ debut: 600, fin: 630 });
  });
});
