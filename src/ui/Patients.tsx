import { MUTUELLES, mutuelleConnue } from '../lib/banque';
import { useEffect, useMemo, useState } from 'react';
import type { Patient } from '../lib/calcul';
import { enregistrer, supprimer } from '../lib/db';
import { articlesDe, calculer, codeOf, DEPLACEMENTS, findTarif, libelle, SECTIONS, tarifsDe } from '../lib/tarifs';
import { eur, NumInput, type Donnees } from './common';

const SEUIL_DEFAUT = 60;
const CODE_SEUIL_DEFAUT = '564270';
const estFb = (article: string) => article.includes('14, 5°, B');

function Fiche({ d, patient, onFini }: { d: Donnees; patient: Patient; onFini: () => void }) {
  const [p, setP] = useState<Patient>(patient);
  const [domicile, setDomicile] = useState(!!patient.codeDeplacement);
  const [enregistre, setEnregistre] = useState(false);
  useEffect(() => { setP(patient); setDomicile(!!patient.codeDeplacement); setEnregistre(false); }, [patient]);
  const maj = (ch: Partial<Patient>) => { setP((x) => ({ ...x, ...ch })); setEnregistre(false); };

  const articles = p.section ? articlesDe(p.section).filter((a) => !a.startsWith('Indemnit')) : [];
  const tarifs = p.section && p.article ? tarifsDe(p.section, p.article) : [];
  const tarif = p.code ? findTarif(p.code) : undefined;
  const profil = { bim: p.bim, conventionne: d.reglages.conventionne, tiersPayant: p.tiersPayant };
  const deplacements = DEPLACEMENTS.filter((t) => t.section === p.section);

  const durees = useMemo(() => {
    const m = new Map<number, number>();
    for (const s of d.seances) if (s.patientId === p.id && !s.annulee) m.set(s.dureeMin, (m.get(s.dureeMin) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [d.seances, p.id]);
  const dureeCode = p.code ? libelle(p.code)?.duree ?? null : null;
  const dureeDiff = dureeCode != null && durees.length > 0 && durees.some(([min]) => min !== dureeCode);

  const choisirArticle = (article: string) => {
    const ch: Partial<Patient> = { article, code: '' };
    if (estFb(article)) {
      if (p.seuil == null) ch.seuil = SEUIL_DEFAUT;
      if (!p.codeApresSeuil && findTarif(CODE_SEUIL_DEFAUT)) ch.codeApresSeuil = CODE_SEUIL_DEFAUT;
    }
    maj(ch);
  };

  const sauver = async () => {
    const final: Patient = { ...p };
    if (!domicile) delete final.codeDeplacement;
    if (!final.codeApresSeuil || !final.seuil) { delete final.codeApresSeuil; delete final.seuil; }
    if (final.honorairesLibres == null) delete final.honorairesLibres;
    await enregistrer('patients', final);
    await d.recharger();
    setEnregistre(true);
  };

  const effacer = async () => {
    const n = d.seances.filter((s) => s.patientId === p.id).length;
    if (!confirm(`Supprimer « ${p.id} » et ses ${n} séance(s) importée(s) ? Cette action est définitive.`)) return;
    for (const s of d.seances.filter((s) => s.patientId === p.id)) await supprimer('seances', s.id);
    await supprimer('patients', p.id);
    await d.recharger();
    onFini();
  };

  return (
    <section className="carte">
      <div className="barre">
        <h2>{p.id}</h2>
        <button onClick={onFini}>Fermer</button>
      </div>

      <div className="grille">
        <label className="champ">
          <span>Lieu de prestation</span>
          <select value={p.section} onChange={(e) => maj({ section: e.target.value, article: '', code: '', codeDeplacement: undefined })}>
            <option value="">Choisir…</option>
            {SECTIONS.map((s) => <option key={s.section} value={s.section}>{s.section} — {s.lieu}</option>)}
          </select>
        </label>
        <label className="champ">
          <span>Pathologie / article</span>
          <select value={p.article} disabled={!p.section} onChange={(e) => choisirArticle(e.target.value)}>
            <option value="">Choisir…</option>
            {articles.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>

      {tarifs.length > 0 && (
        <fieldset>
          <legend>Code de la séance</legend>
          {tarifs.map((t) => {
            const code = codeOf(t);
            const l = libelle(code);
            const m = calculer(t, profil);
            return (
              <label key={code + t.lieu} className={`code ${p.code === code ? 'choisi' : ''}`}>
                <input type="radio" name="code" checked={p.code === code} onChange={() => maj({ code })} />
                <span>
                  <strong>{code}</strong> — {l?.label ?? 'Libellé non disponible'}
                  <br />
                  {l?.duree != null && <>{l.duree} min · </>}
                  {t.honoraires == null ? 'honoraires libres' : <>honoraires {eur(t.honoraires)}</>}
                  {' · '}ticket modérateur {t.honoraires == null ? 'selon votre prix' : eur(m.ticketModerateur)}
                  {l?.conditions && <small className="conditions">{l.conditions}</small>}
                </span>
              </label>
            );
          })}
        </fieldset>
      )}

      {dureeDiff && (
        <p className="avertissement">
          Attention : ce code correspond à {dureeCode} min, mais les séances Rosa de ce patient durent{' '}
          {durees.map(([min, n]) => `${min} min (${n}×)`).join(', ')}. Vérifie le code.
        </p>
      )}

      <div className="cases">
        <label><input type="checkbox" checked={p.bim} onChange={(e) => maj({ bim: e.target.checked })} /> BIM (intervention majorée)</label>
        <label><input type="checkbox" checked={p.tiersPayant} onChange={(e) => maj({ tiersPayant: e.target.checked })} /> Tiers payant</label>
        <label><input type="checkbox" checked={domicile} onChange={(e) => { setDomicile(e.target.checked); setEnregistre(false); }} /> Séances à domicile</label>
      </div>

      <label className="champ">
        <span>Mutuelle (pour retrouver les dispatchs)</span>
        <select value={mutuelleConnue(p.mutuelle ?? '')?.nom ?? ''} onChange={(e) => maj({ mutuelle: e.target.value || undefined })}>
          <option value="">(non renseignée)</option>
          {MUTUELLES.map((m) => <option key={m.code} value={m.nom}>{m.nom}</option>)}
        </select>
      </label>

      <div className="grille">
        <label className="champ">
          <span>Séances déjà faites avant l'import</span>
          <NumInput value={p.seancesAnterieures} onChange={(n) => maj({ seancesAnterieures: Math.max(0, Math.round(n ?? 0)) })} />
        </label>
        <label className="champ">
          <span>Seuil (nombre de séances, optionnel)</span>
          <NumInput value={p.seuil} onChange={(n) => maj({ seuil: n })} placeholder="ex. 60" />
        </label>
        <label className="champ">
          <span>Code après le seuil (optionnel)</span>
          <select value={p.codeApresSeuil ?? ''} onChange={(e) => maj({ codeApresSeuil: e.target.value || undefined })}>
            <option value="">(aucun)</option>
            {p.codeApresSeuil && !tarifs.some((t) => codeOf(t) === p.codeApresSeuil) && (
              <option value={p.codeApresSeuil}>{p.codeApresSeuil}</option>
            )}
            {tarifs.map((t) => <option key={codeOf(t)} value={codeOf(t)}>{codeOf(t)} — {libelle(codeOf(t))?.label ?? ''}</option>)}
          </select>
        </label>
        {tarif?.honoraires == null && p.code && (
          <label className="champ">
            <span>Honoraires libres par séance (€)</span>
            <NumInput value={p.honorairesLibres} onChange={(n) => maj({ honorairesLibres: n })} />
          </label>
        )}
      </div>
      {estFb(p.article) && <p className="aide">Article Fb (§14, 5°, B) : par défaut 60 séances, puis le code 564270.</p>}

      {domicile && (
        <label className="champ">
          <span>Indemnité de déplacement</span>
          <select value={p.codeDeplacement ?? ''} onChange={(e) => maj({ codeDeplacement: e.target.value || undefined })}>
            <option value="">Choisir…</option>
            {deplacements.map((t) => (
              <option key={codeOf(t)} value={codeOf(t)}>
                {codeOf(t)} — {libelle(codeOf(t))?.label ?? t.article} ({t.honoraires != null ? eur(t.honoraires) : 'libre'})
              </option>
            ))}
          </select>
          {p.section && deplacements.length === 0 && <small>Aucune indemnité de déplacement pour ce lieu.</small>}
        </label>
      )}

      <div className="barre">
        <button className="primaire" disabled={!p.code} onClick={() => void sauver()}>Enregistrer</button>
        {enregistre && <span className="ok">Enregistré.</span>}
        <button className="danger" onClick={() => void effacer()}>Supprimer ce patient</button>
      </div>
    </section>
  );
}

export default function Patients({ d }: { d: Donnees }) {
  const [sel, setSel] = useState<string | null>(null);
  const [nom, setNom] = useState('');
  const liste = [...d.patients].sort((a, b) => a.id.localeCompare(b.id, 'fr'));
  const courant = d.patients.find((p) => p.id === sel);

  const ajouter = async () => {
    const id = nom.trim();
    if (!id || d.patients.some((p) => p.id === id)) return;
    await enregistrer('patients', { id, section: '', article: '', code: '', seancesAnterieures: 0, bim: false, tiersPayant: false });
    await d.recharger();
    setNom('');
    setSel(id);
  };

  const nbSeances = (id: string) => d.seances.filter((s) => s.patientId === id && !s.annulee).length;

  return (
    <div>
      <section className="carte">
        <h2>Patients</h2>
        <p className="aide">Les patients arrivent automatiquement à l'import Rosa. Le nom doit être écrit exactement comme dans Rosa.</p>
        <div className="ajout">
          <input value={nom} placeholder="Ajouter un patient à la main" onChange={(e) => setNom(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void ajouter()} />
          <button onClick={() => void ajouter()}>Ajouter</button>
        </div>
        {liste.length === 0 ? (
          <p className="vide">Aucun patient pour le moment.</p>
        ) : (
          <ul className="liste-patients">
            {liste.map((p) => (
              <li key={p.id}>
                <button className={p.id === sel ? 'actif' : ''} onClick={() => setSel(p.id)}>
                  <span>{p.id}</span>
                  <small>{nbSeances(p.id)} séance(s)</small>
                  {p.code ? <small className="code-badge">{p.code}</small> : <small className="a-configurer">à configurer</small>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      {courant && <Fiche d={d} patient={courant} onFini={() => setSel(null)} />}
    </div>
  );
}
