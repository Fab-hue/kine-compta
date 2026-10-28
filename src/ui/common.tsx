import { useEffect, useState } from 'react';
import type { Patient, Seance } from '../lib/calcul';
import type { Dispatch, Reglages, Ticket } from '../lib/db';
import type { Mouvement } from '../lib/banque';

export interface Donnees {
  patients: Patient[];
  seances: Seance[];
  tickets: Ticket[];
  dispatchs: Dispatch[];
  mouvements: Mouvement[];
  reglages: Reglages;
  recharger: () => Promise<void>;
  setReglages: (r: Reglages) => void;
  aller: (onglet: string) => void;
}

const fmt = new Intl.NumberFormat('fr-BE', { style: 'currency', currency: 'EUR' });
export const eur = (n: number) => fmt.format(n);

export const MOIS = [
  'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
  'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
];

export const libelleMois = (ym: string) => `${MOIS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

export const formatDate = (d: string) => (d ? d.split('-').reverse().join('/') : '');

export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const uid = () => crypto.randomUUID();

/** Champ numérique tolérant (virgule ou point), vide = undefined. */
export function NumInput(props: {
  value: number | undefined;
  onChange: (n: number | undefined) => void;
  step?: string;
  placeholder?: string;
  id?: string;
}) {
  const [txt, setTxt] = useState(props.value == null ? '' : String(props.value).replace('.', ','));
  useEffect(() => {
    const cur = Number(txt.replace(',', '.'));
    if (props.value == null ? txt !== '' && !Number.isNaN(cur) : cur !== props.value)
      setTxt(props.value == null ? '' : String(props.value).replace('.', ','));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.value]);
  return (
    <input
      id={props.id}
      type="text"
      inputMode="decimal"
      placeholder={props.placeholder}
      value={txt}
      onChange={(e) => {
        setTxt(e.target.value);
        const t = e.target.value.trim().replace(',', '.');
        if (t === '') props.onChange(undefined);
        else if (!Number.isNaN(Number(t))) props.onChange(Number(t));
      }}
    />
  );
}

export function Vignette({ blob }: { blob: Blob }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer">
      <img className="vignette" src={url} alt="Photo du ticket" />
    </a>
  ) : null;
}
