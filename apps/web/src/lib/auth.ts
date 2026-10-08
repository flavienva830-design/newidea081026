import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { haveIBeenPwned } from "better-auth/plugins/haveibeenpwned";
import { magicLink } from "better-auth/plugins/magic-link";
import { twoFactor } from "better-auth/plugins/two-factor";
import { hmac, parseKek, type RateLimiter } from "@mon-agent-ia/core";
import { limiters } from "./limiters";
import { db } from "./db";
import { env } from "./env";
import { actionEmail, sendMail } from "./mailer";
import { provisionHousehold } from "@/server/household";
import { clientInfo, recordLogin, verifyTurnstile } from "@/server/security";

const MIN_PASSWORD = 12;

const tooMany = (retry: number) =>
  new APIError("TOO_MANY_REQUESTS", { message: `Trop de tentatives. Réessayez dans ${retry} s.` });

function build() {
  const e = env();
  const kek = parseKek(e.KEK_BASE64, e.KEK_VERSION);

  return betterAuth({
    appName: "Mon Agent IA",
    baseURL: e.APP_URL,
    secret: e.AUTH_SECRET,
    trustedOrigins: [e.APP_URL],
    database: prismaAdapter(db(), { provider: "postgresql" }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD,
      maxPasswordLength: 128,
      requireEmailVerification: true,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, url }) => {
        const body = actionEmail({
          title: "Réinitialiser votre mot de passe",
          intro: "Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable 1 heure.",
          cta: "Choisir un nouveau mot de passe",
          url,
        });
        await sendMail({ to: user.email, subject: "Réinitialisation de votre mot de passe", ...body });
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: 3600 * 24,
      sendVerificationEmail: async ({ user, url }) => {
        const body = actionEmail({
          title: "Confirmez votre adresse email",
          intro: "Bienvenue sur Mon Agent IA. Confirmez votre adresse pour activer votre espace.",
          cta: "Confirmer mon email",
          url,
        });
        await sendMail({ to: user.email, subject: "Confirmez votre adresse email", ...body });
      },
    },

    socialProviders:
      e.GOOGLE_CLIENT_ID && e.GOOGLE_CLIENT_SECRET
        ? { google: { clientId: e.GOOGLE_CLIENT_ID, clientSecret: e.GOOGLE_CLIENT_SECRET, prompt: "select_account" } }
        : {},

    account: { accountLinking: { enabled: true, trustedProviders: ["google"] } },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
      cookieCache: { enabled: true, maxAge: 60 },
    },

    advanced: {
      useSecureCookies: e.APP_ENV !== "dev",
      cookiePrefix: "mai",
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
      ipAddress: { ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for", "x-real-ip"] },
    },

    // Limitation intégrée en plus de nos limiteurs par compte (hooks.before).
    rateLimit: { enabled: true, window: 60, max: 60 },

    plugins: [
      twoFactor({
        issuer: "Mon Agent IA",
        totpOptions: { digits: 6, period: 30 },
        backupCodeOptions: { amount: 10, length: 10 },
        accountLockout: { enabled: true, maxFailedAttempts: 6, durationSeconds: 900 },
      }),
      magicLink({
        expiresIn: 60 * 10,
        sendMagicLink: async ({ email, url }) => {
          const body = actionEmail({
            title: "Votre lien de connexion",
            intro: "Ce lien est valable 10 minutes et ne peut être utilisé qu'une fois.",
            cta: "Me connecter",
            url,
          });
          await sendMail({ to: email, subject: "Votre lien de connexion Mon Agent IA", ...body });
        },
      }),
      ...(e.HIBP_ENABLED === "true"
        ? [haveIBeenPwned({ customPasswordCompromisedMessage: "Ce mot de passe apparaît dans des fuites de données. Choisissez-en un autre." })]
        : []),
      nextCookies(), // doit rester le dernier plugin
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        const info = clientInfo(ctx.headers ?? new Headers());
        const path = ctx.path;
        const body = (ctx.body ?? {}) as { email?: string };
        const email = body.email?.trim().toLowerCase();
        const L = limiters();

        const gated = ["/sign-in/email", "/sign-up/email", "/sign-in/magic-link", "/request-password-reset", "/forget-password"];
        if (gated.includes(path)) {
          const token = ctx.headers?.get("x-captcha-response");
          if (!(await verifyTurnstile(token, e.TURNSTILE_SECRET_KEY, info.ip))) {
            throw new APIError("FORBIDDEN", { message: "Vérification anti-robot échouée." });
          }
        }

        const check = async (l: RateLimiter, key: string) => {
          const r = await l.check(key);
          if (!r.allowed) throw tooMany(r.retryAfterSec);
        };

        if (path === "/sign-in/email") {
          await check(L.loginIp, `login:ip:${hmac(info.ip, e.HASH_PEPPER)}`);
          if (email) await check(L.loginAccount, `login:acct:${hmac(email, e.HASH_PEPPER)}`);
        } else if (path === "/sign-up/email") {
          await check(L.signupIp, `signup:ip:${hmac(info.ip, e.HASH_PEPPER)}`);
        } else if (path === "/sign-in/magic-link" && email) {
          await check(L.magic, `magic:${hmac(email, e.HASH_PEPPER)}`);
        } else if ((path === "/request-password-reset" || path === "/forget-password") && email) {
          await check(L.reset, `reset:${hmac(email, e.HASH_PEPPER)}`);
        } else if (path.startsWith("/two-factor/verify")) {
          await check(L.totp, `totp:ip:${hmac(info.ip, e.HASH_PEPPER)}`);
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        // Journal des échecs de connexion par mot de passe (les succès sont journalisés à la création de session).
        if (ctx.path !== "/sign-in/email") return;
        const returned = ctx.context.returned;
        if (!(returned instanceof APIError)) return;
        const email = ((ctx.body ?? {}) as { email?: string }).email;
        if (!email) return;
        try {
          await recordLogin(db(), {
            userId: null,
            email,
            success: false,
            method: "password",
            failReason: String(returned.status ?? "error").toLowerCase(),
            info: clientInfo(ctx.headers ?? new Headers()),
            pepper: e.HASH_PEPPER,
          });
        } catch (err) {
          console.error("[auth] journalisation d'échec impossible", err instanceof Error ? err.name : "erreur");
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            // Foyer + clé de chiffrement + adhésion OWNER, créés avec l'utilisateur.
            await provisionHousehold(db(), { id: user.id, name: user.name || user.email.split("@")[0] || "Moi" }, kek);
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            const info = {
              ip: session.ipAddress ?? "unknown",
              country: null as string | null,
              userAgent: session.userAgent ?? null,
            };
            try {
              const u = await db().user.findUnique({ where: { id: session.userId }, select: { email: true, twoFactorEnabled: true } });
              if (!u) return;
              const risk = await recordLogin(db(), {
                userId: session.userId, email: u.email, success: true, method: "session", info,
                pepper: e.HASH_PEPPER, mfaEnabled: u.twoFactorEnabled,
              });
              if (risk?.suspicious) {
                const body = actionEmail({
                  title: "Nouvelle connexion inhabituelle",
                  intro: "Une connexion à votre compte a été détectée depuis un nouvel appareil ou une nouvelle zone. Si c'était vous, tout va bien. Sinon, changez immédiatement votre mot de passe et activez la double authentification.",
                  cta: "Sécuriser mon compte",
                  url: `${e.APP_URL}/app/settings/security`,
                  outro: "Cet email est envoyé automatiquement pour protéger votre compte.",
                });
                await sendMail({ to: u.email, subject: "Alerte de sécurité : nouvelle connexion", ...body });
              }
            } catch (err) {
              console.error("[auth] évaluation de connexion impossible", err instanceof Error ? err.name : "erreur");
            }
          },
        },
      },
    },
  });
}

type Auth = ReturnType<typeof build>;
const g = globalThis as unknown as { __auth?: Auth };

/** Instance unique (paresseuse : l'environnement n'est lu qu'à la première requête, pas au build). */
export function auth(): Auth {
  return (g.__auth ??= build());
}
