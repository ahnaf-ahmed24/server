import { Router, type Request, type Response } from "express";
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { ObjectId } from "mongodb";
import { getCollection } from "../db/mongo";
import { clientOrigin, env } from "../config/env";
import { signToken, verifyToken } from "../utils/jwt";
import { AUTH_COOKIE, clearAuthCookie, setAuthCookie } from "../utils/cookies";
import { HttpError, sendSuccess, wrap } from "../utils/helpers";
import { oidToString, serializeUser, type PublicUser } from "../utils/serialize";
import type { AuthPayload, UserDoc } from "../types";

export const authRouter = Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface CredentialsBody {
  name?: string;
  email?: string;
  photoURL?: string;
  password?: string;
}

const credentialsOf = (req: Request): CredentialsBody => req.body ?? {};

const oidOf = (user: UserDoc) =>
  user._id ? oidToString(user._id) : user.email;


function passwordError(password: string): string | null {
  if (!/[A-Z]/.test(password)) return "Password must include an uppercase letter (A–Z).";
  if (!/[a-z]/.test(password)) return "Password must include a lowercase letter (a–z).";
  if (password.length < 6) return "Password must be at least 6 characters.";
  return null;
}


authRouter.post(
  "/register",
  wrap(async (req, res) => {
    const { name, email, photoURL, password } = credentialsOf(req);
    const normalizedEmail = (email ?? "").trim().toLowerCase();

    if (!name?.trim()) throw new HttpError(400, "Please enter your full name.");
    if (!EMAIL_RE.test(normalizedEmail))
      throw new HttpError(400, "Please enter a valid email address.");
    const policyError = passwordError(password ?? "");
    if (policyError) throw new HttpError(400, policyError);

    const users = await getCollection<UserDoc>("users");
    const existing = await users.findOne({ email: normalizedEmail });
    if (existing)
      throw new HttpError(
        409,
        "An account with this email already exists. Please log in instead."
      );

    const hashed = await bcrypt.hash(password as string, 10);
    const doc: UserDoc = {
      name: name.trim(),
      email: normalizedEmail,
      photoURL: (photoURL ?? "").trim() || undefined,
      password: hashed,
      provider: "credentials",
      role: "user",
      joinedAt: new Date(),
    };
    await users.insertOne(doc);


    issueSession(res, doc);

    res.status(201).json({
      success: true,
      message: "Account created successfully. You are now signed in.",
      data: { user: serializeUser(doc) },
    });
  })
);

authRouter.post(
  "/login",
  wrap(async (req, res) => {
    const { email, password } = credentialsOf(req);
    const normalizedEmail = (email ?? "").trim().toLowerCase();
    if (!EMAIL_RE.test(normalizedEmail))
      throw new HttpError(400, "Please enter a valid email address.");

    const users = await getCollection<UserDoc>("users");
    const user = await users.findOne({ email: normalizedEmail });

    if (!user)
      throw new HttpError(
        404,
        "No account found for this email — please register first."
      );
    if (!user.password)
      throw new HttpError(
        401,
        `This email was registered with ${user.provider === "github" ? "GitHub" : "Google"}. Please use that button to sign in.`
      );

    const match = await bcrypt.compare(password ?? "", user.password);
    if (!match) throw new HttpError(401, "Incorrect password. Please try again.");

    setAuthCookie(
      res,
      signToken({ id: oidOf(user), email: user.email, name: user.name })
    );

    res.json({
      success: true,
      message: `Welcome back, ${user.name}!`,
      data: { user: serializeUser(user) },
    });
  })
);


authRouter.post("/logout", (_req, res) => {
  clearAuthCookie(res);
  res.json({
    success: true,
    message: "Logged out successfully.",
    data: { user: null },
  });
});

authRouter.get(
  "/me",
  wrap(async (req, res) => {
    const token = req.cookies?.[AUTH_COOKIE] as string | undefined;
    let user: PublicUser | null = null;

    if (token) {
      let payload: AuthPayload | null = null;
      try {
        payload = verifyToken(token);
      } catch {
        payload = null;
      }

      if (payload) {
        const users = await getCollection<UserDoc>("users");
        const doc =
          payload.id && ObjectId.isValid(payload.id)
            ? await users.findOne({ _id: new ObjectId(payload.id) })
            : null;
        if (doc) user = serializeUser(doc);
      }
    }

    res.json({ success: true, data: { user } });
  })
);



const STATE_COOKIE = "studio_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

interface OAuthState {
  csrf: string;
  from: string;
}

const apiBaseOf = (req: Request) =>
  env.publicApiUrl || `${req.protocol}://${req.get("host")}`;

const redirectUri = (req: Request, provider: string) =>
  `${apiBaseOf(req)}/api/auth/${provider}/callback`;

function encodeState(state: OAuthState): string {
  return Buffer.from(JSON.stringify(state), "utf8").toString("base64url");
}

function decodeState(encoded: string): OAuthState | null {
  try {
    const state = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (state && typeof state === "object" && typeof state.csrf === "string")
      return state as OAuthState;
  } catch {
    /* fall through */
  }
  return null;
}

function bounce(res: Response, from: string, slug: string) {
  const page = from === "register" ? "register" : "login";
  res.clearCookie(STATE_COOKIE, { path: "/" });
  res.redirect(`${clientOrigin}/${page}?socialError=${encodeURIComponent(slug)}`);
}

function oauthConfigured(provider: "google" | "github"): boolean {
  return provider === "google"
    ? Boolean(env.googleClientId && env.googleClientSecret)
    : Boolean(env.githubClientId && env.githubClientSecret);
}

function oauthStart(provider: "google" | "github") {
  return (req: Request, res: Response) => {
    const from = String(req.query.from ?? "") === "register" ? "register" : "login";

    if (!oauthConfigured(provider)) {
      const name = provider === "google" ? "Google" : "GitHub";
      bounce(res, from, `${provider}-unconfigured:${name} OAuth credentials aren't set on the server (see server/.env.example).`);
      return;
    }

    const state: OAuthState = { csrf: randomBytes(16).toString("hex"), from };
    res.cookie(STATE_COOKIE, encodeState(state), {
      httpOnly: true,
      path: "/",
      maxAge: STATE_TTL_MS,
      sameSite: env.isProd ? ("none" as const) : ("lax" as const),
      secure: env.isProd,
    });

    if (provider === "google") {
      const params = new URLSearchParams({
        client_id: env.googleClientId,
        redirect_uri: redirectUri(req, "google"),
        response_type: "code",
        scope: "openid email profile",
        state: encodeState(state),
        prompt: "select_account",
      });
      res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    } else {
      const params = new URLSearchParams({
        client_id: env.githubClientId,
        redirect_uri: redirectUri(req, "github"),
        scope: "read:user user:email",
        state: encodeState(state),
      });
      res.redirect(`https://github.com/login/oauth/authorize?${params}`);
    }
  };
}

authRouter.get("/google", oauthStart("google"));
authRouter.get("/github", oauthStart("github"));


async function upsertSocialUser(profile: {
  name: string;
  email: string;
  photoURL: string;
  provider: "google" | "github";
}): Promise<UserDoc> {
  const users = await getCollection<UserDoc>("users");
  const email = profile.email.trim().toLowerCase();

  const existing = await users.findOne({ email });
  if (existing) {
    if (!existing.photoURL && profile.photoURL) {
      await users.updateOne(
        { _id: existing._id! },
        { $set: { photoURL: profile.photoURL } }
      );
      return { ...existing, photoURL: profile.photoURL };
    }
    return existing;
  }

  const doc: UserDoc = {
    name: profile.name.trim() || email.split("@")[0],
    email,
    photoURL: profile.photoURL || undefined,
    password: null,
    provider: profile.provider,
    role: "user",
    joinedAt: new Date(),
  };
  await users.insertOne(doc);
  return doc;
}

function issueSession(res: Response, user: UserDoc) {
  setAuthCookie(
    res,
    signToken({ id: oidOf(user), email: user.email, name: user.name })
  );
}

authRouter.get("/google/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const queryState = String(req.query.state ?? "");
  const cookieState =
    (req.cookies?.[STATE_COOKIE] as string | undefined) ?? "";
  const state = decodeState(queryState);

  if (
    req.query.error ||
    !code ||
    !cookieState ||
    !queryState ||
    cookieState !== queryState ||
    !state
  ) {
    bounce(res, state?.from ?? "login", "Google sign-in failed. Please try again.");
    return;
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: redirectUri(req, "google"),
        grant_type: "authorization_code",
      }),
    });
    const tokenJson = (await tokenRes.json()) as { id_token?: string };
    if (!tokenJson.id_token) throw new Error("Google did not return an id_token");

    const parts = tokenJson.id_token.split(".");
    if (parts.length !== 3) throw new Error("Malformed Google id_token");
    const claims = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf8")
    ) as { email?: string; name?: string; picture?: string };
    if (!claims.email) throw new Error("Google account has no email");

    const user = await upsertSocialUser({
      name: claims.name ?? "",
      email: claims.email,
      photoURL: claims.picture ?? "",
      provider: "google",
    });

    res.clearCookie(STATE_COOKIE, { path: "/" });
    issueSession(res, user);
    res.redirect(`${clientOrigin}/`);
  } catch {
    bounce(res, state.from, "Google sign-in failed. Please try again.");
  }
});

authRouter.get("/github/callback", async (req, res) => {
  const code = String(req.query.code ?? "");
  const queryState = String(req.query.state ?? "");
  const cookieState =
    (req.cookies?.[STATE_COOKIE] as string | undefined) ?? "";
  const state = decodeState(queryState);

  if (
    req.query.error ||
    !code ||
    !cookieState ||
    !queryState ||
    cookieState !== queryState ||
    !state
  ) {
    bounce(res, state?.from ?? "login", "GitHub sign-in failed. Please try again.");
    return;
  }

  try {
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        code,
        client_id: env.githubClientId,
        client_secret: env.githubClientSecret,
        redirect_uri: redirectUri(req, "github"),
      }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token)
      throw new Error("GitHub did not return an access token");
    const token = tokenJson.access_token;

    const headers = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
    };
    const profileRes = await fetch("https://api.github.com/user", { headers });
    const profile = (await profileRes.json()) as {
      login?: string;
      name?: string | null;
      email?: string | null;
      avatar_url?: string;
    };
    if (!profile.login) throw new Error("GitHub profile unavailable");

    let email = profile.email ?? "";
    if (!email) {
      const emailsRes = await fetch("https://api.github.com/user/emails", { headers });
      if (emailsRes.ok) {
        const emails = (await emailsRes.json()) as {
          email: string;
          primary: boolean;
          verified: boolean;
        }[];
        email = emails.find((e) => e.verified)?.email ?? emails[0]?.email ?? "";
      }
    }
    if (!email) throw new Error("GitHub account has no verified email");

    const user = await upsertSocialUser({
      name: profile.name || profile.login,
      email,
      photoURL: profile.avatar_url ?? "",
      provider: "github",
    });

    res.clearCookie(STATE_COOKIE, { path: "/" });
    issueSession(res, user);
    res.redirect(`${clientOrigin}/`);
  } catch {
    bounce(res, state.from, "GitHub sign-in failed. Please try again.");
  }
});
