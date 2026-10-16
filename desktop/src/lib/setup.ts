export type ProviderId = "aws" | "r2" | "wasabi" | "b2" | "local";

export interface Provider {
  id: ProviderId;
  label: string;
  region: string;
  endpoint: string;
  /** Shown under the server address field. */
  endpointHint: string;
}

export const PROVIDERS: Provider[] = [
  { id: "aws", label: "Amazon S3", region: "us-east-1", endpoint: "", endpointHint: "Leave this empty for Amazon S3." },
  {
    id: "r2",
    label: "Cloudflare R2",
    region: "auto",
    endpoint: "https://ACCOUNT_ID.r2.cloudflarestorage.com",
    endpointHint: "Replace ACCOUNT_ID with the ID shown on your Cloudflare R2 page.",
  },
  { id: "wasabi", label: "Wasabi", region: "us-east-1", endpoint: "https://s3.wasabisys.com", endpointHint: "Use the address for your Wasabi region." },
  {
    id: "b2",
    label: "Backblaze B2",
    region: "us-west-004",
    endpoint: "https://s3.us-west-004.backblazeb2.com",
    endpointHint: "Shown as the S3 endpoint on your Backblaze bucket page.",
  },
  {
    id: "local",
    label: "Local test server",
    region: "us-east-1",
    endpoint: "http://localhost:8333",
    endpointHint: "The test server that runs on this Mac.",
  },
];

export function providerLabel(endpoint: string | null | undefined): string {
  const ep = (endpoint ?? "").trim().toLowerCase();
  if (!ep) return "Amazon S3";
  if (ep.includes("localhost") || ep.includes("127.0.0.1")) return "Local test server";
  if (ep.includes("r2.cloudflarestorage.com")) return "Cloudflare R2";
  if (ep.includes("wasabisys.com")) return "Wasabi";
  if (ep.includes("backblazeb2.com")) return "Backblaze B2";
  if (ep.includes("amazonaws.com")) return "Amazon S3";
  try {
    return new URL(ep).host;
  } catch {
    return ep;
  }
}

export interface SetupValues {
  provider: ProviderId;
  endpoint: string;
  bucket: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  passphrase: string;
  passphrase_confirm: string;
  folder: string;
  device_name: string;
}

/** Which setup step a setup_vault error most likely belongs to, so we can send the user back there. */
export function setupErrorStep(raw: string): number {
  const e = raw.toLowerCase();
  if (e.includes("passphrase")) return 3;
  if (/access key|secret|invalidaccesskeyid|signaturedoesnotmatch|accessdenied|forbidden|keychain/.test(e)) return 2;
  if (/bucket|region|endpoint|connect|dispatch|timed out|dns|network/.test(e)) return 1;
  return 4;
}

export const SETUP_STEPS = 4;
export const MIN_PASSPHRASE = 12;

/** Returns a plain-English problem with the given step, or null when it is complete. */
export function validateSetupStep(step: number, v: SetupValues): string | null {
  switch (step) {
    case 1:
      if (!v.bucket.trim()) return "Enter the name of your bucket.";
      if (!v.region.trim()) return "Enter the region. If you're not sure, use us-east-1.";
      if (v.endpoint.includes("ACCOUNT_ID")) return "Replace ACCOUNT_ID in the server address with your Cloudflare account ID.";
      return null;
    case 2:
      if (!v.access_key_id.trim()) return "Enter the access key ID from your storage provider.";
      if (!v.secret_access_key.trim()) return "Enter the secret access key from your storage provider.";
      return null;
    case 3:
      if ([...v.passphrase].length < MIN_PASSPHRASE) return `Your passphrase needs at least ${MIN_PASSPHRASE} characters.`;
      if (v.passphrase !== v.passphrase_confirm) return "The two passphrases don't match.";
      return null;
    case 4:
      if (!v.folder.trim()) return "Choose where your RenegadeBox folder should live.";
      if (v.device_name.includes("/")) return "The name for this Mac can't contain a slash.";
      return null;
    default:
      return null;
  }
}
