/**
 * Bounds for the public surface ⟨CP8⟩.
 *
 * Every one of these exists because the endpoints below have no session behind
 * them. An authenticated endpoint with a generous limit costs one known user
 * some memory; an unauthenticated one costs whatever anybody asks for.
 */

/**
 * Page sizes.
 *
 * `maxLimit` is the ceiling a request can ask for, not a suggestion — a query
 * string saying `limit=100000` is answered with 48 rows, silently and without
 * complaint, because refusing would only tell somebody probing that they found
 * the edge.
 */
export const PUBLIC_PAGE = {
  /** A directory grid. Twelve rows of two, or four rows of six. */
  defaultLimit: 24,
  maxLimit: 48,

  /**
   * How many published projects one profile page renders.
   *
   * A Student has one Final Task per Batch, so this is a bound on how many
   * cohorts somebody has been through — generous, and still finite.
   */
  maxProjectsPerProfile: 20,

  /**
   * How far the filter-options scan reads.
   *
   * The option lists are built from published rows rather than the catalogs, so
   * this walks real data. It is capped because it is unauthenticated: the
   * result is that a very large corpus would build its filter list from the
   * most recent slice, which is the right thing to lose.
   */
  optionScanLimit: 500,
} as const;

/**
 * How long a public response may be cached.
 *
 * Short, because publication can be withdrawn. A Student who removes consent
 * expects to disappear, and a long cache would leave them on a CDN for as long
 * as it lasted. Sixty seconds is enough to absorb a burst and short enough that
 * "I took it down" stays approximately true.
 */
export const PUBLIC_CACHE_SECONDS = 60;

/**
 * How long a public photo may be cached.
 *
 * Longer, because the URL carries a version stamp taken from `photoUpdatedAt`:
 * a replaced photo is a different address, so a stale one cannot be served for
 * a photo that changed. Withdrawal is still bounded by the route re-checking
 * publication on every request.
 */
export const PUBLIC_PHOTO_CACHE_SECONDS = 300;

/** The filter keys a Visitor may send. Anything else is ignored, not refused. */
export const PUBLIC_FILTER_KEYS: readonly string[] = [
  'targetRole',
  'city',
  'educationStatus',
  'technologies',
  'hasDemo',
];
