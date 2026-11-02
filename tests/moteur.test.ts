import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { calculer, findTarif, libelle } from '../src/lib/tarifs';
import { calculerSeances, totauxParMois, type Patient } from '../src/lib/calcul';
import { devinerCorrespondance, extraireRdv, lireCsv, parseDate, parseDuree } from '../src/lib/rosa';
import { paiementDe, partMutuelle, partPatient } from '../src/lib/suivi';
import { depensesFixes, lignesColonne, remplirExcel } from '../src/lib/excel';

const conv = { bim: false, conventionne: true };

describe('tarifs', () => {
  it('560011 non-BIM conventionné : TM 6,25', () => {
    const m = calculer(findTarif('560011')!, { ...conv, tiersPayant: false });
    expect(m).toMatchObject({ honoraires: 31.64, intervention: 25.39, ticketModerateur: 6.25, patient: 31.64, mutuelle: 0 });
  });
  it('tiers payant BIM : patient 2,50, mutuelle 29,14', () => {
    const m = calculer(findTarif('560011')!, { bim: true, conventionne: true, tiersPayant: true });
    expect(m.patient).toBe(2.5);
    expect(m.mutuelle).toBe(29.14);
  });
  it('libellés présents', () => {
    expect(libelle('567011')?.duree).toBe(30);
  });
});

describe('séances', () => {
  const p: Patient = {
    id: 'A', section: 'I. a)', article: '', code: '563614', codeApresSeuil: '564270', seuil: 60,
    seancesAnterieures: 59, bim: false, tiersPayant: false,
  };
  it('bascule au tarif réduit après le seuil', () => {
    const s = [1, 2].map((i) => ({ id: String(i), patientId: 'A', date: `2026-03-0${i}`, dureeMin: 30 }));
    const c = calculerSeances(s, new Map([['A', p]]), true);
    expect(c.map((x) => x.code)).toEqual(['563614', '564270']);
    expect(c[1].honoraires).toBe(26.37);
    const t = totauxParMois(c, 2026);
    expect(t[2].nbSeances).toBe(2);
  });
  it('déplacement ajouté à domicile', () => {
    const d = { ...p, code: '560011', codeApresSeuil: undefined, codeDeplacement: '639111' };
    const c = calculerSeances([{ id: '1', patientId: 'A', date: '2026-01-05', dureeMin: 30 }], new Map([['A', d]]), true);
    expect(c[0].honoraires).toBe(r(31.64 + 1.38));
  });
});
const r = (n: number) => Math.round(n * 100) / 100;

describe('rosa', () => {
  it('lit un CSV point-virgule et calcule la durée', () => {
    const csv = 'Nom;Prénom;Date;Début;Fin;Statut\nDupont;Anne;03/02/2026;09:00;09:30;Confirmé\nMartin;Luc;03/02/2026;10:00;11:00;Annulé\n';
    const { colonnes, lignes } = lireCsv(csv);
    const c = devinerCorrespondance(colonnes);
    const rdv = extraireRdv(lignes, c);
    expect(rdv).toEqual([
      { patient: 'Dupont Anne', date: '2026-02-03', heure: '09:00', dureeMin: 30, annule: false },
      { patient: 'Martin Luc', date: '2026-02-03', heure: '10:00', dureeMin: 60, annule: true },
    ]);
  });
  it('formats', () => {
    expect(parseDate('2026-02-03 09:00')).toEqual({ date: '2026-02-03', heure: '09:00' });
    expect(parseDuree('1h')).toBe(60);
    expect(parseDuree('00:30')).toBe(30);
    expect(parseDuree('45 min')).toBe(45);
  });
});

describe('excel', () => {
  it('regroupe par mois au-delà de 42 tickets', () => {
    const deps = Array.from({ length: 50 }, (_, i) => ({
      id: String(i), date: `2026-${String((i % 12) + 1).padStart(2, '0')}-10`, montant: 1, colonne: 'N', fournisseur: '',
    }));
    expect(lignesColonne(deps)).toHaveLength(12);
  });
  it('remplit le modèle et garde les formules', async () => {
    const buf = readFileSync('public/Fis26__BLANC.xlsx');
    const mois = Array.from({ length: 12 }, (_, m) => ({ mois: m, carnet: 100 + m, virements: 50, nbSeances: 3 }));
    const out = await remplirExcel(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), {
      mois,
      depenses: [...depensesFixes(2026, [{ colonne: 'A', montant: 350, libelle: 'Loyer' }]),
        { id: 'x', date: '2026-02-01', montant: 12.5, colonne: 'N', fournisseur: 'Total' }],
      identite: { nomPrenom: 'TEST Kiné' },
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(out);
    const rec = wb.getWorksheet('Recettes')!;
    expect(rec.getCell('E8').value).toBe(101);
    expect((rec.getCell('I7').value as { formula: string }).formula).toBe('E7+G7');
    const dep = wb.worksheets.find((w) => w.name.endsWith('Dépenses'))!;
    expect(dep.getCell('A15').value).toBe(350);
    expect(dep.getCell('N4').value).toBe(12.5);
    writeFileSync('tests/sortie.xlsx', Buffer.from(out));
  });
});

import { analyserTicket } from '../src/lib/ticket';
describe('ticket', () => {
  it('trouve date, total et carburant', () => {
    const t = analyserTicket('SHELL BRUXELLES\n12/03/2026 14:22\nDiesel 40,12 L\nTVA 21% 9,80\nTOTAL EUR 62,45\nBancontact 62,45');
    expect(t).toMatchObject({ date: '2026-03-12', montant: 62.45, fournisseur: 'SHELL BRUXELLES', colonne: 'N' });
  });
});

import { lireReleve, numerosDispatch, parseMontant, rapprocherDispatchs, dispatchsDansTexte, paiementsPatient, virementsDispatch, lireEcranKinequick, fusionnerEcransKinequick, lireExtraitBnp } from '../src/lib/banque';

describe('banque', () => {
  it('numéros de dispatch : 3 chiffres + /', () => {
    expect(numerosDispatch('+++370/0123/45678+++')).toEqual(['370']);
    expect(numerosDispatch('REF 5370/2026 paiement')).toEqual([]);
    expect(numerosDispatch('dispatch 366 /01 et 369/02')).toEqual(['366', '369']);
  });
  it('montants belges', () => {
    expect(parseMontant('1.234,56')).toBe(1234.56);
    expect(parseMontant('-12,50')).toBe(-12.5);
    expect(parseMontant('58.40')).toBe(58.4);
  });
  it('relevé CSV → dispatchs et patients', () => {
    const csv = [
      'Date;Montant;Nom de la contrepartie;Communication',
      '05/03/2026;412,30;MUTUALITE CHRETIENNE;+++370/0123/45678+++',
      '06/03/2026;98,10;SOLIDARIS;5370/2026',
      '07/03/2026;31,64;DUPONT ANNE;seances fevrier',
      '08/03/2026;-350,00;PROPRIETAIRE;loyer',
    ].join('\n');
    const { mouvements } = lireReleve(csv);
    expect(mouvements).toHaveLength(4);
    const r = rapprocherDispatchs(['370', '366'], mouvements);
    expect(r.get('370')?.map((m) => m.montant)).toEqual([412.3]);
    expect(r.get('366')).toEqual([]);
    expect(paiementsPatient('Dupont Anne', mouvements).map((m) => m.montant)).toEqual([31.64]);
  });
  it('même dispatch pour deux mutuelles', () => {
    const csv =
      'Date;Montant;Contrepartie;Communication\n' +
      '10/03/2026;120,00;FMSB;+++363/0001/00012+++\n' +
      '11/03/2026;85,40;LCM-ANMC;363/0002/00099\n';
    const { mouvements } = lireReleve(csv);
    const s = virementsDispatch({ numero: '363', mutuelle: 'Solidaris' }, mouvements);
    expect(s.recus.map((m) => m.montant)).toEqual([120]);
    expect(s.autres.map((m) => m.montant)).toEqual([85.4]);
    expect(virementsDispatch({ numero: '363', mutuelle: 'Alliance' }, mouvements).recus.map((m) => m.montant)).toEqual([85.4]);
    expect(virementsDispatch({ numero: '363' }, mouvements).recus).toHaveLength(2);
  });
  it('dispatchs sur capture Kinéquick', () => {
    const ocr = 'Dispatch 370 03/02/2026 412,30 €\nDispatch 366/ 1.234,56\n2026 ref 5370 envoi 10:30 369';
    expect(dispatchsDansTexte(ocr)).toEqual(['370', '366', '369']);
  });
  it('format BNP : EN/ZE 364, F.M.S.B., montant 29,14+', () => {
    expect(numerosDispatch('10000000000 EN/ZE 364 TP')).toEqual(['364']);
    expect(numerosDispatch('EN/ZE 3640')).toEqual([]);
    expect(parseMontant('29,14+')).toBe(29.14);
    expect(parseMontant('350,00-')).toBe(-350);
    const m = { id: 'x', date: '2026-09-30', montant: 29.14, nom: 'F.M.S.B.', communication: '10000000000 EN/ZE 364 TP' };
    expect(virementsDispatch({ numero: '364', mutuelle: 'Solidaris' }, [m]).recus).toHaveLength(1);
    expect(virementsDispatch({ numero: '364', mutuelle: 'Alliance' }, [m]).recus).toHaveLength(0);
  });
  it('écran Kinéquick eFact : code mutuelle non pris pour un dispatch', () => {
    const ocr = [
      'Date Listing Dispatch Montant Statut Organisme',
      '26/10/2026 TP202620 370 € 29,14 Impayé 300 Solidaris, Union Nationale',
      '21/09/2026 TP202618 364 € 58,28 Payé 100 Alliance Nationale des Mu',
    ].join('\n');
    expect(lireEcranKinequick(ocr)).toEqual([
      { numero: '370', mutuelle: 'Solidaris', montant: 29.14, etat: 'impaye', date: '2026-10-26', listing: '2620' },
      { numero: '364', mutuelle: 'Alliance', montant: 58.28, etat: 'paye', date: '2026-09-21', listing: '2618' },
    ]);
  });
  it('écran Kinéquick : erreurs de lecture tolérées et deux lectures fusionnées', () => {
    const l1 = lireEcranKinequick([
      '000 an 0/2026 TP202613 362 € 29,14 Payé 100 Alliance Nationale des Mu',
      'E 23/09/2026 1P202608 360 €2914  Payé 100 Alliance Nationale des Mi',
      '24/09/2026 TP202607 36 € 29,14 Payé 300 Solidaris, Union',
    ].join('\n'));
    expect(l1.map((x) => [x.numero, x.montant, x.listing])).toEqual([['362', 29.14, '2613'], ['360', 29.14, '2608']]);
    const l2 = lireEcranKinequick([
      '6  TP202613 362 € 29,14 Payé',
      '44/10/2026 TP202607 364 € 116,56 Payé 200 Solidaris, Union Nationale',
      'TP202620 370 € 29,14 Impayé 300 Solida',
    ].join('\n'));
    expect(l2[1]).toEqual({ numero: '364', mutuelle: 'Solidaris', montant: 116.56, etat: 'paye', listing: '2607' });
    expect(l2[2].mutuelle).toBe('Solidaris');
    const f = fusionnerEcransKinequick([l1, l2]);
    expect(f.map((x) => [x.listing, x.numero, x.mutuelle])).toEqual([
      ['2620', '370', 'Solidaris'], ['2613', '362', 'Alliance'], ['2608', '360', 'Alliance'], ['2607', '364', 'Solidaris'],
    ]);
  });
  it('extrait PDF BNP (lignes fictives)', () => {
    const L = (...m: [number, string][]) => m.map(([x, s]) => ({ x, s }));
    const lignes = [
      L([45, '30-09-2026']),
      L([45, '0398'], [74, 'Virement en euros'], [305, 'BE00 0000 0000 0000'], [442, '30-09'], [527, '29,14+']),
      L([74, 'Communication : 10000000000 EN/ZE 364'], [305, 'GEBABEBB']),
      L([74, 'TP'], [305, 'F.M.S.B.']),
      L([74, 'Référence banque : 0000'], [305, 'RUE FICTIVE 1']),
      L([45, '0399'], [74, 'Paiement mobile'], [442, '30-09'], [527, '31,64+']),
      L([74, 'Bancontact']),
      L([45, 'Solde précédent']),
    ];
    const mv = lireExtraitBnp(lignes);
    expect(mv.map((x) => [x.date, x.montant, x.nom])).toEqual([
      ['2026-09-30', 29.14, 'F.M.S.B.'],
      ['2026-09-30', 31.64, 'Bancontact'],
    ]);
    expect(numerosDispatch(mv[0].communication)).toEqual(['364']);
  });
});

describe('suivi des paiements', () => {
  it('paiement par défaut selon le tiers payant, parts patient / mutuelle', () => {
    const s = { id: 'a', patientId: 'X', date: '2026-02-03', dureeMin: 30 };
    expect(paiementDe(s, { tiersPayant: true }).mode).toBe('tm');
    expect(paiementDe(s, { tiersPayant: false }).mode).toBe('totalite');
    const p: Patient = { id: 'X', section: 'I.a', article: '7', code: '560011', seancesAnterieures: 0, bim: true, tiersPayant: true };
    const [c] = calculerSeances([s], new Map([['X', p]]), true);
    expect(partPatient(c, 'tm')).toBe(2.5);
    expect(partMutuelle(c, 'tm')).toBe(29.14);
    expect(partPatient(c, 'totalite')).toBe(31.64);
    expect(partMutuelle(c, 'totalite')).toBe(0);
  });
});

import { codeCreneau, creneauxDuJour, fusionner, lignesCreneau, montantCreneau, resumeMois, separer, type Creneau } from '../src/lib/creneaux';

describe('créneaux', () => {
  const j = '2026-12-14';
  it('19 créneaux de 8h00 à 17h00 par défaut', () => {
    const c = creneauxDuJour(j, []);
    expect(c).toHaveLength(19);
    expect(c[0].id).toBe('2026-12-14|08:00');
    expect(c.at(-1)!.id).toBe('2026-12-14|17:00');
    expect(c.some((x) => x.id.endsWith('13:00'))).toBe(true);
  });
  it('fusion avec le suivant puis le précédent, statut gardé, notes jointes', () => {
    const jour = creneauxDuJour(j, []);
    jour[2] = { ...jour[2], statut: 'paye', mode: 'tiers', commentaire: 'J.D.' };
    const r = fusionner(jour, 2, 1)!;
    expect(r.fusion).toMatchObject({ id: '2026-12-14|09:00', debut: 540, fin: 600, statut: 'paye', mode: 'tiers' });
    expect(r.supprime).toBe('2026-12-14|09:30');
    const apres = creneauxDuJour(j, [r.fusion]);
    expect(apres).toHaveLength(18);
    const i = apres.findIndex((x) => x.id === r.fusion.id);
    const r2 = fusionner(apres, i, -1)!;
    expect(r2.fusion).toMatchObject({ id: '2026-12-14|08:30', debut: 510, fin: 600, statut: 'paye', commentaire: 'J.D.' });
    expect(r2.supprime).toBe('2026-12-14|09:00');
  });
  it('pas de fusion au bord, séparation, résumé du mois', () => {
    const jour = creneauxDuJour(j, []);
    expect(fusionner(jour, 0, -1)).toBeNull();
    expect(fusionner(jour, 18, 1)).toBeNull();
    const long: Creneau = { id: 'x', date: j, debut: 600, fin: 690, statut: 'arecevoir', mode: 'totalite' };
    expect(separer(long).fin).toBe(630);
    expect(creneauxDuJour(j, [long])).toHaveLength(17);
    expect(resumeMois([long, { ...long, id: 'y', debut: 720, fin: 750, statut: 'paye', mode: 'tiers' }], '2026-12')).toEqual({
      paye: { totalite: 0, tiers: 1, nombre: 1, patient: 6.25, mutuelle: 25.39 },
      arecevoir: { totalite: 1, tiers: 0, nombre: 1, patient: 31.64, mutuelle: 0 },
    });
  });
});

describe('montants des créneaux', () => {
  const base: Creneau = { id: 'z', date: '2026-12-14', debut: 480, fin: 510, statut: 'paye', mode: 'tiers' };
  it('codes et montants par pathologie, BIM, domicile', () => {
    expect(codeCreneau({})).toBe('560011');
    expect(codeCreneau({ pathologie: 'fa', domicile: true })).toBe('563312');
    expect(montantCreneau({ ...base, bim: true })).toMatchObject({ patient: 2.5, mutuelle: 29.14 });
    expect(montantCreneau(base)).toMatchObject({ patient: 6.25, mutuelle: 25.39 });
    expect(montantCreneau({ ...base, bim: true, pathologie: 'fa', domicile: true })).toMatchObject({ patient: 2, mutuelle: 32.81 });
    expect(montantCreneau({ ...base, mode: 'totalite', pathologie: 'e', bim: true })).toMatchObject({ patient: 31.64, mutuelle: 0, intervention: 30.26 });
    expect(montantCreneau({ ...base, mode: 'totalite' })).toMatchObject({ patient: 31.64, intervention: 25.39 });
    expect(codeCreneau({ pathologie: 'fb60' })).toBe('564270');
    expect(codeCreneau({ pathologie: 'perinatal', domicile: true })).toBe('561654');
    expect(montantCreneau({ ...base, pathologie: 'fb60', domicile: true })).toMatchObject({ honoraires: 29.53, patient: 5.5, mutuelle: 24.03 });
    expect(montantCreneau({ ...base, statut: undefined })).toBeNull();
  });
  it('bilan, rapport, prestation E', () => {
    const fa = { ...base, pathologie: 'fa' as const, supplements: ['rapport' as const] };
    expect(lignesCreneau(fa).map((l) => l.code)).toEqual(['563010', '563076']);
    expect(montantCreneau(fa)).toMatchObject({ honoraires: 66.26, patient: 6.37, mutuelle: 59.89 });
    expect(montantCreneau({ ...base, supplements: ['bilan'], domicile: true })).toMatchObject({ honoraires: 42.19, mutuelle: 35.94 });
    const e = { ...base, pathologie: 'e' as const, bim: true, supplements: ['prestation' as const, 'rapport' as const] };
    expect(lignesCreneau(e).map((l) => l.code)).toEqual(['560652', '560711', '560696']);
    expect(montantCreneau(e)).toMatchObject({ patient: r(1.38 + 0.87 + 1), mutuelle: r(30.26 + 33.75 + 6.44) });
    // supplément d'une autre pathologie : ignoré
    expect(lignesCreneau({ ...base, pathologie: 'perinatal', supplements: ['rapport'] })).toHaveLength(1);
  });
  it('part patient déjà payée en tiers payant', () => {
    const c: Creneau = { ...base, statut: 'arecevoir', patientPaye: true };
    expect(resumeMois([c], '2026-12')).toEqual({
      paye: { totalite: 0, tiers: 0, nombre: 0, patient: 6.25, mutuelle: 0 },
      arecevoir: { totalite: 0, tiers: 1, nombre: 1, patient: 0, mutuelle: 25.39 },
    });
  });
  it('la fusion garde pathologie et domicile', () => {
    const j = '2026-12-14';
    const jour = creneauxDuJour(j, [{ ...base, pathologie: 'fb', domicile: true, commentaire: 'A.B.' }]);
    const r = fusionner(jour, 0, 1)!;
    expect(r.fusion).toMatchObject({ pathologie: 'fb', domicile: true, statut: 'paye' });
  });
});

import { montantCreneau as mc, totauxCreneauxParMois } from '../src/lib/creneaux';
import { delaiProchainRappel, icsRappel, rappelDu } from '../src/lib/rappel';

describe('agenda → export et rappel 18h', () => {
  const cr = (date: string, ch: Partial<Creneau>): Creneau => ({ id: `${date}|09:00`, date, debut: 540, fin: 570, ...ch });
  it('totaux de l\'agenda par mois (payé + à recevoir, libres ignorés)', () => {
    const a = cr('2026-03-02', { statut: 'paye', mode: 'tiers' });
    const b = cr('2026-03-03', { statut: 'arecevoir', mode: 'totalite' });
    const c = cr('2026-03-04', { commentaire: 'AB' });
    const t = totauxCreneauxParMois([a, b, c, cr('2025-03-02', { statut: 'paye' })], 2026);
    const ma = mc(a, true)!, mb = mc(b, true)!;
    expect(t[2].nbSeances).toBe(2);
    expect(t[2].carnet).toBe(0);
    expect(t[2].virements).toBeCloseTo(ma.patient + ma.mutuelle + mb.patient + mb.mutuelle, 2);
    expect(t[2].virements).toBeGreaterThan(0);
    expect(t[1].nbSeances).toBe(0);
  });
  it('rappel : jour ouvré après 18h et journée vide seulement', () => {
    const lun18 = new Date(2026, 10, 2, 18, 5);
    expect(rappelDu(lun18, [])).toBe(true);
    expect(rappelDu(new Date(2026, 10, 2, 17, 59), [])).toBe(false);
    expect(rappelDu(new Date(2026, 10, 1, 19, 0), [])).toBe(false); // dimanche
    expect(rappelDu(lun18, [cr('2026-11-02', { statut: 'paye' })])).toBe(false);
    expect(delaiProchainRappel(new Date(2026, 10, 2, 17, 0))).toBe(3600_000);
    expect(delaiProchainRappel(new Date(2026, 10, 2, 18, 0))).toBe(24 * 3600_000);
    const ics = icsRappel('https://exemple.test/', new Date(2026, 10, 2));
    expect(ics).toContain('DTSTART:20261102T180000');
    expect(ics).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(ics).toContain('BEGIN:VALARM');
  });
});

import { creneauxSous, seancesParJour, totauxCreneauxParMois as tcm, profilsPatients as pp, resumeMois as rm } from '../src/lib/creneaux';

describe('compte des séances : blocs fusionnés', () => {
  const j = '2026-11-02';
  const s = (id: string, debut: number, fin: number, patient: string): Creneau =>
    ({ id, date: j, debut, fin, statut: 'paye', mode: 'tiers', patient });
  // bloc fusionné 9h-10h + un ancien créneau 9h30 resté caché dessous + un créneau 10h
  const cr = [s('a', 540, 600, 'TEST A'), s('b', 570, 600, 'TEST B'), s('c', 600, 630, 'TEST C')];

  it('un créneau caché sous un bloc fusionné ne compte pas', () => {
    expect(creneauxDuJour(j, cr).filter((c) => c.statut).length).toBe(2);
    expect(tcm(cr, 2026)[10].nbSeances).toBe(2);
    expect(rm(cr, j).paye.nombre).toBe(2);
    expect(seancesParJour(cr, 2026)).toEqual([expect.objectContaining({ date: j, nombre: 2 })]);
    expect(pp(cr).map((p) => p.nom)).not.toContain('TEST B');
  });

  it('creneauxSous trouve aussi les créneaux cachés', () => {
    expect(creneauxSous(cr, j, 540, 600, 'a').map((c) => c.id)).toEqual(['b']);
  });
});
