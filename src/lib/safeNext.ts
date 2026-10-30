/** Only same-site paths, so ?next= can't send users to another site after login. */
export const safeNextPath = (next: string | null, fallback: string) =>
  next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
