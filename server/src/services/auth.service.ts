import { randomUUID } from "node:crypto";
import type { PasswordHasher } from "../auth/password.js";
import type { TokenSigner } from "../auth/tokens.js";
import { DomainError } from "../domain/errors.js";
import type { Actor, UserWithDepartment } from "../domain/types.js";
import type { UnitOfWork } from "../repositories/index.js";
import type { RefreshTokenRepository } from "../repositories/refresh-token.repository.js";

export interface RegisterInput {
  email: string;
  password: string;
  fullName: string;
  departmentId: string;
  rollNo?: string | undefined;
}

export interface Session {
  user: UserWithDepartment;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export class AuthService {
  /** Compared against when the email is unknown, so login timing doesn't reveal which emails exist. */
  private dummyHash: Promise<string>;

  constructor(
    private readonly uow: UnitOfWork,
    private readonly passwords: PasswordHasher,
    private readonly tokens: TokenSigner,
    private readonly refreshTtlSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dummyHash = passwords.hash(randomUUID());
  }

  async register(input: RegisterInput): Promise<Session> {
    // TODO(v2): email-domain allowlist check goes here (open signup in v1 per CLAUDE.md §2b).
    const department = await this.uow.read.departments.findById(input.departmentId);
    if (!department) {
      throw new DomainError("DEPARTMENT_NOT_FOUND", "Department does not exist");
    }

    const passwordHash = await this.passwords.hash(input.password);
    const created = await this.uow.transaction(async (tx) => {
      const user = await tx.users.create({
        email: input.email,
        passwordHash,
        fullName: input.fullName,
        departmentId: department.id,
        rollNo: input.rollNo ?? null,
      });
      // A taken email aborts the transaction; throwing here rolls it back.
      if (!user) throw new DomainError("EMAIL_TAKEN", "An account with this email already exists");
      return user;
    });

    return this.startSession({ ...created, department });
  }

  async login(email: string, password: string): Promise<Session> {
    const creds = await this.uow.read.users.findCredentialsByEmail(email);
    const ok = await this.passwords.verify(password, creds?.passwordHash ?? (await this.dummyHash));
    if (!creds || !ok) {
      throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect");
    }
    if (!creds.isActive) {
      throw new DomainError("ACCOUNT_DISABLED", "This account has been deactivated");
    }
    const user = await this.uow.read.users.findByIdWithDepartment(creds.id);
    if (!user) throw new DomainError("INVALID_CREDENTIALS", "Email or password is incorrect");
    return this.startSession(user);
  }

  /**
   * Rotates a refresh token. Presenting a token that was already rotated or
   * revoked is treated as theft: the whole token family is revoked, logging
   * out both the attacker and the legitimate holder.
   */
  async refresh(presentedToken: string): Promise<Session> {
    const claims = this.tokens.verifyRefresh(presentedToken);
    if (!claims) {
      throw new DomainError("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
    }

    const now = this.now();
    const outcome = await this.uow.transaction(async (repos) => {
      const record = await repos.refreshTokens.findById(claims.tokenId);
      if (!record || record.userId !== claims.userId || record.familyId !== claims.familyId) {
        return { kind: "invalid" } as const;
      }
      if (record.expiresAt <= now) return { kind: "invalid" } as const;

      const rotated = await repos.refreshTokens.markRotated(record.id, now);
      if (!rotated) {
        // Revocation must commit, so we return rather than throw inside the transaction.
        await repos.refreshTokens.revokeFamily(record.familyId, now);
        return { kind: "reused" } as const;
      }

      const user = await repos.users.findByIdWithDepartment(record.userId);
      if (!user || !user.isActive) {
        await repos.refreshTokens.revokeFamily(record.familyId, now);
        return { kind: "disabled" } as const;
      }

      const next = await this.issueRefreshToken(repos.refreshTokens, user.id, record.familyId);
      return { kind: "ok", user, ...next } as const;
    });

    switch (outcome.kind) {
      case "invalid":
        throw new DomainError("INVALID_REFRESH_TOKEN", "Refresh token is invalid or expired");
      case "reused":
        throw new DomainError(
          "REFRESH_TOKEN_REUSED",
          "Refresh token was already used; all sessions in this family have been revoked",
        );
      case "disabled":
        throw new DomainError("ACCOUNT_DISABLED", "This account has been deactivated");
      case "ok":
        return {
          user: outcome.user,
          accessToken: this.tokens.signAccess(outcome.user.id),
          refreshToken: outcome.token,
          refreshExpiresAt: outcome.expiresAt,
        };
    }
  }

  /** Revokes the session family of the presented token. Idempotent; ignores bad tokens. */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) return;
    const claims = this.tokens.verifyRefresh(presentedToken);
    if (!claims) return;
    await this.uow.transaction((repos) => repos.refreshTokens.revokeFamily(claims.familyId, this.now()));
  }

  /** Resolves a bearer access token to the current actor, re-reading role and status from the DB. */
  async authenticate(accessToken: string): Promise<Actor> {
    const claims = this.tokens.verifyAccess(accessToken);
    if (!claims) throw new DomainError("UNAUTHENTICATED", "Access token is invalid or expired");
    const user = await this.uow.read.users.findById(claims.userId);
    if (!user) throw new DomainError("UNAUTHENTICATED", "Access token is invalid or expired");
    if (!user.isActive) throw new DomainError("ACCOUNT_DISABLED", "This account has been deactivated");
    return { id: user.id, role: user.role, departmentId: user.departmentId, isActive: user.isActive };
  }

  async me(actor: Actor): Promise<UserWithDepartment> {
    const user = await this.uow.read.users.findByIdWithDepartment(actor.id);
    if (!user) throw new DomainError("UNAUTHENTICATED", "User no longer exists");
    return user;
  }

  private async startSession(user: UserWithDepartment): Promise<Session> {
    const { token, expiresAt } = await this.uow.transaction((repos) =>
      this.issueRefreshToken(repos.refreshTokens, user.id, randomUUID()),
    );
    return {
      user,
      accessToken: this.tokens.signAccess(user.id),
      refreshToken: token,
      refreshExpiresAt: expiresAt,
    };
  }

  private async issueRefreshToken(
    repo: RefreshTokenRepository,
    userId: string,
    familyId: string,
  ): Promise<{ token: string; expiresAt: Date }> {
    const id = randomUUID();
    const expiresAt = new Date(this.now().getTime() + this.refreshTtlSeconds * 1000);
    await repo.create({ id, familyId, userId, expiresAt });
    return { token: this.tokens.signRefresh({ userId, tokenId: id, familyId }), expiresAt };
  }
}
