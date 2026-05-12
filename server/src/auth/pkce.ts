import crypto from "node:crypto";

export type PkcePair = {
  verifier: string;
  challenge: string;
  method: "S256";
};

export function newPkce(): PkcePair {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge, method: "S256" };
}
