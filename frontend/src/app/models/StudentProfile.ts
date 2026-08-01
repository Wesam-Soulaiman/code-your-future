import { ProfileCatalogItem } from './ProfileCatalogItem';

/**
 * The safe Student profile DTO.
 *
 * Mirrors `backend/src/cloudCode/modules/StudentProfile/dto.ts` exactly. Fields
 * the backend deliberately withholds — the `user` pointer, the photo bytes or
 * any URL, ACL, and anything from `StudentAuthIdentity` — are absent here too,
 * so no component can depend on data the API does not send.
 *
 * This is the owner's own profile, which is why it legitimately carries their
 * phone, date of birth, and city: it is only ever returned to the Student it
 * belongs to.
 */
export interface StudentProfile {
  /** Empty string before the first save. */
  id: string;
  fullName: string;
  /** Verified at the identity provider. Read-only. */
  verifiedEmail: string;
  phone?: string;
  /**
   * The four catalog selections, already resolved ⟨CP3A catalog⟩.
   *
   * Each is the localised item itself, never a bare id the browser would have
   * to look up and never a raw pointer. `active: false` is how the form shows
   * that a stored answer has since been retired by an Admin.
   */
  city?: ProfileCatalogItem;
  /** `YYYY-MM-DD`. */
  dateOfBirth?: string;
  institution?: ProfileCatalogItem;
  customInstitutionName?: string;
  major?: ProfileCatalogItem;
  educationStatus?: string;
  /** `YYYY-MM` — the UI works in months, not days. */
  expectedGraduationMonth?: string;
  careerGoal?: string;
  /** Optional. Never affects completion. */
  targetRole?: ProfileCatalogItem;
  /** Optional, ≤ 500 characters. Only present alongside a target role. */
  targetRoleReason?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
  /** True when a photo exists; the bytes come from a separate authorised call. */
  hasPhoto: boolean;
  /** Opaque cache key that changes whenever the photo does. */
  photoVersion?: string;
  /**
   * True only on the empty shape, when `fullName` arrived prefilled from the
   * verified Google claims. Lets the form say where the name came from and that
   * it can be changed. Never present once a profile exists.
   */
  nameFromProvider?: boolean;
  /** Calculated server-side. The client never decides this. */
  isComplete: boolean;
}

/**
 * What the form sends. Exactly the writable fields, nothing more.
 *
 * The catalog selections travel as **ids**. A name is never sent — the backend
 * resolves the authoritative item, so nothing the browser invents can be stored.
 */
export interface StudentProfileInput {
  fullName: string;
  phone: string;
  cityId: string;
  dateOfBirth?: string;
  institutionId: string;
  customInstitutionName?: string;
  majorId: string;
  educationStatus: string;
  expectedGraduationMonth?: string;
  careerGoal?: string;
  targetRoleId?: string;
  targetRoleReason?: string;
  githubUrl?: string;
  linkedinUrl?: string;
  portfolioUrl?: string;
}

/** What the photo endpoint answers with. No URL, no storage path, no bytes. */
export interface ProfilePhotoResult {
  ok: boolean;
  mimeType: string;
  bytes: number;
}
