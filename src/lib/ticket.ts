// Analyse du texte OCR d'un ticket : date, total, fournisseur, catégorie probable.

export interface TicketLu {
  date?: string;
  montant?: number;
  fournisseur?: string;
  colonne?: string;
}

const MOTS_TOTAL = /total|a payer|à payer|montant|bancontact|payconiq|visa|mastercard|carte|cash|esp[eè]ces|net/i;
const MONTANT = /(\d{1,5})[,.](\d{2})(?!\d)/g;

const montants = (l: string) => [...l.matchAll(MONTANT)].map((m) => Number(`${m[1]}.${m[2]}`));

export function analyserTicket(texte: string): TicketLu {
  const lignes = texte.split('\n').map((l) => l.trim()).filter(Boolean);
  const res: TicketLu = {};

  for (const l of lignes) {
    const m = l.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
    if (m && Number(m[2]) <= 12 && Number(m[1]) <= 31) {
      const y = m[3].length === 2 ? `20${m[3]}` : m[3];
      res.date = `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      break;
    }
  }

  // Le total est sur une ligne « TOTAL / À PAYER… », sinon le plus grand montant du ticket.
  const lignesTotal = lignes.filter((l) => MOTS_TOTAL.test(l) && !/sous.?total|tva|btw|htva/i.test(l));
  const candidats = lignesTotal.flatMap(montants);
  const tous = lignes.flatMap(montants);
  const choix = candidats.length ? candidats : tous;
  if (choix.length) res.montant = Math.max(...choix);

  res.fournisseur = lignes.find((l) => /[a-z]{3,}/i.test(l) && !/ticket|bienvenue|welcome/i.test(l))?.slice(0, 40);
  res.colonne = devinerCategorie(texte);
  return res;
}

const REGLES: [RegExp, string][] = [
  [/shell|esso|q8|total ?energies|texaco|lukoil|gulf|dats|carburant|diesel|essence|benzine/i, 'N'],
  [/sncb|nmbs|stib|mivb|tec\b|de lijn|taxi|uber/i, 'R'],
  [/parking|interparking|indigo|be-mobile/i, 'O'],
  [/proximus|orange|telenet|base\b|voo\b|mobile vikings/i, 'U'],
  [/fnac|mediamarkt|coolblue|krefel|vanden borre|apple|microsoft/i, 'X'],
  [/club|standaard|bureau|office|papeterie|librairie/i, 'W'],
  [/decathlon|kine|physio|th[ée]raband|sissel|mobilis|medical|m[ée]dical/i, 'AA'],
  [/pharmacie|apotheek|massage|cr[eè]me|huile|gel\b/i, 'CN'],
  [/action|hema|brico|gamma|hubo|ikea/i, 'CE'],
  [/delhaize|colruyt|carrefour|aldi|lidl|restaurant|caf[ée]|brasserie/i, 'AC'],
];

export function devinerCategorie(texte: string): string | undefined {
  return REGLES.find(([re]) => re.test(texte))?.[1];
}
