import { createHash, randomBytes } from "node:crypto";

/** Token opaco de 256 bits, apto para URL. */
export const newToken = () => randomBytes(32).toString("base64url");

/** Solo se persiste el hash; un volcado de BD no permite usar los tokens. */
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
