import { z } from "zod";

export const usernameSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9_]{3,20}$/, "3 a 20 caracteres: letras, números o guion bajo");
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(8, "Mínimo 8 caracteres").max(128);
export const deviceTypeSchema = z.enum(["web", "launcher", "android"]);

const deviceFields = {
  deviceType: deviceTypeSchema,
  deviceName: z.string().trim().max(100).optional(),
};

export const registerSchema = z
  .object({
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: "Debés aceptar los términos" }) }),
    ...deviceFields,
  })
  .refine((d) => d.password === d.passwordConfirm, { path: ["passwordConfirm"], message: "Las contraseñas no coinciden" });

export const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(254), // email o nombre de usuario
  password: z.string().min(1).max(128),
  ...deviceFields,
});

export const tokenBodySchema = z.object({ token: z.string().min(20).max(200) });
export const forgotPasswordSchema = z.object({ email: emailSchema });
export const resetPasswordSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema, passwordConfirm: z.string() })
  .refine((d) => d.password === d.passwordConfirm, { path: ["passwordConfirm"], message: "Las contraseñas no coinciden" });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface PublicUser {
  id: string;
  username: string;
  email: string;
  role: "user" | "developer" | "moderator" | "admin";
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  expiresAt: string;
  user: PublicUser;
}

export interface SessionInfo {
  id: string;
  deviceType: z.infer<typeof deviceTypeSchema>;
  deviceName: string | null;
  createdAt: string;
  lastUsedAt: string;
  current: boolean;
}
