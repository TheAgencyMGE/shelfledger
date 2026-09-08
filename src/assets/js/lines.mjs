/**
 * Figure lines, inferred from what the sources actually publish.
 *
 * Retailers rarely tag the line, but they nearly always put it in the product
 * title, because that is how collectors search. So a line is only assigned when
 * the title literally contains it. Nothing here guesses: if a title does not
 * name its line, the release has no line and simply does not appear under that
 * filter.
 *
 * Order matters. The most specific pattern that matches wins, so
 * "Transformers Generations Legacy" beats "Transformers".
 */

const LINES = [
  // Hasbro
  { line: 'Marvel Legends', maker: 'Hasbro', re: /\bmarvel legends\b/i },
  { line: 'Star Wars The Black Series', maker: 'Hasbro', re: /\bblack series\b/i },
  { line: 'Star Wars The Vintage Collection', maker: 'Hasbro', re: /\bvintage collection\b/i },
  { line: 'G.I. Joe Classified', maker: 'Hasbro', re: /\bg\.?i\.?\s*joe classified\b/i },
  { line: 'Transformers Generations', maker: 'Hasbro', re: /\btransformers\b.*\b(generations|legacy|studio series)\b/i },
  { line: 'Transformers', maker: 'Hasbro', re: /\btransformers\b/i },
  { line: 'Power Rangers Lightning Collection', maker: 'Hasbro', re: /\blightning collection\b/i },

  // McFarlane
  { line: 'DC Multiverse', maker: 'McFarlane', re: /\bdc multiverse\b/i },
  { line: 'Warhammer 40,000', maker: 'McFarlane', re: /\bwarhammer\b/i },

  // Mattel
  { line: 'Masters of the Universe Masterverse', maker: 'Mattel', re: /\bmasterverse\b/i },
  { line: 'Masters of the Universe Origins', maker: 'Mattel', re: /\bmotu origins\b|\bmasters of the universe origins\b/i },

  // Bandai / Tamashii
  { line: 'S.H.Figuarts', re: /\bs\.?h\.?\s?figuarts\b/i },
  { line: 'S.H.MonsterArts', re: /\bs\.?h\.?\s?monsterarts\b/i },
  { line: 'Figuarts ZERO', re: /\bfiguarts\s?zero\b/i },
  { line: 'Robot Damashii', re: /\brobot damashii\b|ROBOT魂/i },
  { line: 'Metal Build', re: /\bmetal build\b/i },
  { line: 'Chogokin', re: /\bchogokin\b|超合金/i },

  // Other makers
  { line: 'MAFEX', maker: 'Medicom', re: /\bmafex\b/i },
  { line: 'figma', maker: 'Good Smile', re: /\bfigma\b/i },
  { line: 'Nendoroid', maker: 'Good Smile', re: /\bnendoroid\b/i },
  { line: 'One:12 Collective', maker: 'Mezco', re: /\bone:?12 collective\b/i },
  { line: '5 Points', maker: 'Mezco', re: /\b5 points\b/i },
  { line: 'Ultimates', maker: 'Super7', re: /\bultimates\b/i },
  { line: 'ReAction', maker: 'Super7', re: /\breaction\b/i },
  { line: 'Hot Toys Movie Masterpiece', maker: 'Hot Toys', re: /\bmovie masterpiece\b/i },
  { line: 'Bring Arts', re: /\bbring arts\b/i },
  { line: 'Figuarts mini', re: /\bfiguarts mini\b/i },

  // Funko
  { line: 'Bitty Pop!', maker: 'Funko', re: /\bbitty pop!?\b/i },
  { line: 'Pocket Pop!', maker: 'Funko', re: /\bpocket pop!?\b/i },
  { line: 'Vinyl Soda', maker: 'Funko', re: /\bvinyl soda\b/i },
  { line: 'Pop!', maker: 'Funko', re: /\bpop!\b|\bpop! vinyl\b/i },
];

/**
 * The line named in a title, or null. `known` is a line the source stated
 * outright, which always wins over anything inferred from text.
 */
export function inferLine(name, known = null) {
  if (known) return known;
  const title = String(name ?? '');
  for (const entry of LINES) {
    if (entry.re.test(title)) return entry.line;
  }
  return null;
}

/** The manufacturer a line belongs to, when the line implies one. */
export function makerForLine(line) {
  return LINES.find((entry) => entry.line === line)?.maker ?? null;
}

/** Every line this build can recognise, for documentation and tests. */
export function knownLines() {
  return LINES.map(({ line, maker }) => ({ line, maker: maker ?? null }));
}
